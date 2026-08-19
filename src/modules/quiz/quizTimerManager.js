import { Session, Slide } from "../../core/database/models/index.js";
import { syncer } from "../../../realtime/syncer.js";
import { invalidateCachedSession } from "../../../realtime/cache.js";

class QuizTimerManager {
  constructor() {
    this._timers = new Map();
  }

  /**
   * Starts an authoritative server quiz timer for a session.
   */
  async startQuizTimer(sessionId, slideId, timeLimitSeconds = 30) {
    const key = sessionId.toString();

    if (this._timers.has(key)) {
      clearTimeout(this._timers.get(key));
      this._timers.delete(key);
    }

    const durationMs = Math.max(5000, (Number(timeLimitSeconds) || 30) * 1000);
    const now = Date.now();
    const startedAt = new Date(now);
    const endsAt = new Date(now + durationMs);

    // Persist server-authoritative timer state in MongoDB
    await Session.findByIdAndUpdate(sessionId, {
      $set: {
        currentSlideId: slideId,
        isVotingLocked: false,
        quizState: {
          slideId,
          startedAt,
          endsAt,
          durationMs,
          isLocked: false,
        },
        lastActivityAt: startedAt,
      },
      $inc: { version: 1, eventSequence: 1 },
    });

    invalidateCachedSession(sessionId);

    // Schedule single wake-up timer
    const timer = setTimeout(() => {
      this._timers.delete(key);
      this.handleQuizTimeout(sessionId, slideId);
    }, durationMs);

    this._timers.set(key, timer);

    return { startedAt, endsAt, durationMs };
  }

  /**
   * Called when a quiz timer expires. Locks quiz, updates session, and auto-advances to LEADERBOARD if next.
   */
  async handleQuizTimeout(sessionId, slideId) {
    try {
      const key = sessionId.toString();
      if (this._timers.has(key)) {
        clearTimeout(this._timers.get(key));
        this._timers.delete(key);
      }

      const session = await Session.findById(sessionId).lean();
      if (!session || session.status !== "live") return;

      // Lock voting and set quizState.isLocked = true
      await Session.findByIdAndUpdate(sessionId, {
        $set: {
          isVotingLocked: true,
          "quizState.isLocked": true,
          lastActivityAt: new Date(),
        },
        $inc: { version: 1, eventSequence: 1 },
      });

      invalidateCachedSession(sessionId);
      await syncer.broadcastState(sessionId, true);

      // Check if next slide is LEADERBOARD
      const slides = await Slide.find({ presentationId: session.presentationId })
        .sort({ position: 1 })
        .lean();

      const currentIndex = slides.findIndex((s) => s._id.toString() === slideId.toString());
      if (currentIndex !== -1 && currentIndex + 1 < slides.length) {
        const nextSlide = slides[currentIndex + 1];
        if (nextSlide.type === "LEADERBOARD") {
          // Wait 2.5 seconds so participants see final quiz timer reveal, then auto-advance to LEADERBOARD
          setTimeout(async () => {
            try {
              await Session.findByIdAndUpdate(sessionId, {
                $set: {
                  currentSlideId: nextSlide._id,
                  currentSlidePosition: nextSlide.position,
                  isVotingLocked: false,
                  lastActivityAt: new Date(),
                },
                $inc: { version: 1, eventSequence: 1 },
              });
              invalidateCachedSession(sessionId);
              await syncer.broadcastState(sessionId, true);
              await syncer.broadcastLeaderboard(sessionId, true);
            } catch (err) {
              console.error("[QuizTimerManager] Error auto-advancing to LEADERBOARD:", err);
            }
          }, 2500);
        }
      }
    } catch (error) {
      console.error("[QuizTimerManager] Error handling quiz timeout:", error);
    }
  }

  /**
   * Node.js Process Restart Recovery:
   * Restores authoritative quiz timers from persisted session state in MongoDB on server startup.
   */
  async initRestartRecovery() {
    try {
      const activeSessions = await Session.find({
        status: "live",
        "quizState.endsAt": { $ne: null },
        "quizState.isLocked": false,
      }).lean();

      const now = Date.now();

      for (const session of activeSessions) {
        const { slideId, endsAt } = session.quizState;
        if (!endsAt || !slideId) continue;

        const expirationTime = new Date(endsAt).getTime();
        const remainingMs = expirationTime - now;

        if (remainingMs <= 0) {
          // Expired during downtime -> trigger timeout immediately
          console.log(`[QuizTimerManager] Recovered expired quiz timer for session ${session._id}`);
          this.handleQuizTimeout(session._id, slideId);
        } else {
          // Still active -> re-schedule timer
          console.log(`[QuizTimerManager] Restored active quiz timer for session ${session._id} (${Math.round(remainingMs / 1000)}s remaining)`);
          const key = session._id.toString();
          const timer = setTimeout(() => {
            this._timers.delete(key);
            this.handleQuizTimeout(session._id, slideId);
          }, remainingMs);

          this._timers.set(key, timer);
        }
      }
    } catch (error) {
      console.error("[QuizTimerManager] Restart recovery error:", error);
    }
  }
}

export const quizTimerManager = new QuizTimerManager();
