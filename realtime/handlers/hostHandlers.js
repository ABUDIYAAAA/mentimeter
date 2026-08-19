import { Session, Slide } from "../../src/core/database/models/index.js";
import { syncer } from "../syncer.js";
import { wipePresentationSessionData } from "../../src/modules/session/session.service.js";
import { invalidateCachedSession, invalidateCachedSlide } from "../cache.js";
import { quizTimerManager } from "../../src/modules/quiz/quizTimerManager.js";

const verifyHost = async (socket) => {
  if (!socket.user || !socket.sessionId) {
    throw new Error("Unauthorized: Only the host can perform this action");
  }

  const session = await Session.findOne({
    _id: socket.sessionId,
    presenterId: socket.user._id,
  }).lean();

  if (!session) {
    throw new Error(
      "Unauthorized: You do not have permission to modify this session",
    );
  }

  return session;
};

const updateSessionWithOCC = async (socket, updateFieldsBuilder, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const session = await verifyHost(socket);
    const versionVal = typeof session.version === "number" ? session.version : 0;

    const versionQuery = {
      _id: socket.sessionId,
      $or: [{ version: versionVal }, { version: { $exists: false } }],
    };

    const updateFields =
      typeof updateFieldsBuilder === "function"
        ? updateFieldsBuilder(session)
        : updateFieldsBuilder;

    const updated = await Session.findOneAndUpdate(versionQuery, updateFields, {
      new: true,
    });
    if (updated) {
      return { updatedSession: updated, session };
    }
  }
  throw new Error("Conflict: Concurrent session update detected. Please try again.");
};

export const handleSessionStatusChange = async (socket, { status }) => {
  const validStatuses = ["waiting", "live", "paused", "finished"];
  if (!validStatuses.includes(status)) {
    throw new Error(
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
    );
  }

  const { session } = await updateSessionWithOCC(socket, (sess) => {
    const updateFields = {
      $set: { status, lastActivityAt: new Date() },
      $inc: { version: 1, eventSequence: 1 },
    };

    if (status === "live" && !sess.startedAt) {
      updateFields.$set.startedAt = new Date();
    } else if (status === "paused") {
      updateFields.$set.pausedAt = new Date();
    } else if (status === "finished") {
      updateFields.$set.endedAt = new Date();
    }

    return updateFields;
  });

  if (status === "waiting") {
    await wipePresentationSessionData(session.presentationId);
    const slides = await Slide.find({ presentationId: session.presentationId }).lean();
    for (const slide of slides) {
      await syncer.broadcastSlideAnalytics(socket.sessionId, slide._id, slide.type);
    }
  }

  invalidateCachedSession(socket.sessionId);

  console.log(
    `[WS Host] Session ${socket.sessionId} status changed to: ${status}`,
  );

  await syncer.broadcastState(socket.sessionId);

  return { status };
};

export const handleToggleVotingLock = async (socket, { isLocked }) => {
  if (typeof isLocked !== "boolean") {
    throw new Error("isLocked must be a boolean");
  }

  await updateSessionWithOCC(socket, {
    $set: {
      isVotingLocked: isLocked,
      lastActivityAt: new Date(),
    },
    $inc: { version: 1, eventSequence: 1 },
  });

  invalidateCachedSession(socket.sessionId);

  console.log(
    `[WS Host] Session ${socket.sessionId} voting lock changed to: ${isLocked}`,
  );

  await syncer.broadcastState(socket.sessionId);

  return { isVotingLocked: isLocked };
};

export const handleSlideChange = async (socket, { slideId }) => {
  if (!slideId) {
    throw new Error("slideId is required");
  }

  const session = await verifyHost(socket);

  const targetSlide = await Slide.findOne({
    _id: slideId,
    presentationId: session.presentationId,
  }).lean();

  if (!targetSlide) {
    throw new Error(
      "Invalid slide: This slide does not belong to the active presentation",
    );
  }

  if (targetSlide.type === "QUIZ") {
    const existingQuizState = session.quizState;
    const isSameQuizSlide =
      existingQuizState &&
      existingQuizState.slideId &&
      existingQuizState.slideId.toString() === slideId.toString();

    if (isSameQuizSlide && existingQuizState.startedAt) {
      // Timer was ALREADY started for this quiz slide -> do NOT restart!
      const isExpired = existingQuizState.endsAt ? Date.now() >= new Date(existingQuizState.endsAt).getTime() : false;
      const isLocked = existingQuizState.isLocked || isExpired;

      const updatedSession = await Session.findOneAndUpdate(
        { _id: socket.sessionId, version: session.version },
        {
          $set: {
            currentSlideId: slideId,
            currentSlidePosition: targetSlide.position,
            isVotingLocked: isLocked,
            "quizState.isLocked": isLocked,
            lastActivityAt: new Date(),
          },
          $inc: { version: 1, eventSequence: 1 },
        },
        { new: true }
      );

      if (!updatedSession) {
        throw new Error("Conflict: Concurrent slide change detected. Please try again.");
      }
      invalidateCachedSession(socket.sessionId);
      invalidateCachedSlide(slideId);
    } else {
      // First time opening this quiz slide -> start timer ONCE!
      const timeLimit = targetSlide.quizSettings?.timeLimitSeconds || 30;
      await quizTimerManager.startQuizTimer(socket.sessionId, slideId, timeLimit, targetSlide.position, session.version);
    }
  } else {
    // Standard presentation slides (BAR_GRAPH, WORD_CLOUD, SCALES, CONTENT, LEADERBOARD)
    const updatedSession = await Session.findOneAndUpdate(
      { _id: socket.sessionId, version: session.version },
      {
        $set: {
          currentSlideId: slideId,
          currentSlidePosition: targetSlide.position,
          isVotingLocked: false, // Auto-reset lock when moving to non-quiz slides
          lastActivityAt: new Date(),
        },
        $inc: { version: 1, eventSequence: 1 },
      },
      { new: true }
    );

    if (!updatedSession) {
      throw new Error("Conflict: Concurrent slide change detected. Please try again.");
    }
    invalidateCachedSession(socket.sessionId);
    invalidateCachedSlide(slideId);
  }

  // If host moved to LEADERBOARD slide, immediately compile and broadcast top 10 snapshot
  if (targetSlide.type === "LEADERBOARD") {
    await syncer.broadcastLeaderboard(socket.sessionId, true);
  }

  console.log(
    `[WS Host] Session ${socket.sessionId} changed to slide: ${slideId} (${targetSlide.type})`,
  );

  // Broadcast authoritative state change immediately so ALL participants move to the current slide
  await syncer.broadcastState(socket.sessionId, true);

  return { currentSlideId: slideId, order: targetSlide.position };
};
