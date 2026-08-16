import crypto from "crypto";
import { sessionRepository } from "./session.repository.js";
import { presentationRepository } from "../presentation/presentation.repository.js";
import { Session } from "../../core/database/models/index.js";

const generateSessionCode = async () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  let exists = true;

  while (exists) {
    code = "";
    for (let i = 0; i < 6; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      code += chars[randomIndex];
    }
    exists = await sessionRepository.checkCodeExists(code);
  }

  return code;
};

class SessionService {
  async createSession(ownerId, presentationId) {
    const presentation = await sessionRepository.findPresentationByIdAndOwner(
      presentationId,
      ownerId,
    );
    if (!presentation) {
      throw new Error("Presentation not found or unauthorized");
    }

    let session = await sessionRepository.findActiveSessionByPresentationId(
      presentationId,
      ownerId,
    );

    const slides = await presentationRepository.findSlidesByPresentation(presentationId);
    const firstSlide = slides && slides[0];
    const firstSlideId = firstSlide ? firstSlide._id : null;

    if (!session) {
      const code = await generateSessionCode();

      session = await sessionRepository.createSession({
        presentationId,
        presenterId: ownerId,
        code,
        status: "waiting",
        currentSlideId: firstSlideId,
      });
    } else if (!session.currentSlideId && firstSlideId) {
      await Session.findByIdAndUpdate(session._id, { $set: { currentSlideId: firstSlideId } });
      session.currentSlideId = firstSlideId;
    }

    return {
      session,
    };
  }

  async joinSession(code, nickname) {
    const session = await sessionRepository.findSessionByCode(
      code.toUpperCase(),
    );
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status === "cancelled" || session.status === "finished") {
      throw new Error("Session is not active");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const participant = await sessionRepository.createParticipant({
      sessionId: session._id,
      nickname,
      tokenHash,
      status: "active",
    });

    return {
      participantToken: rawToken,
      participantId: participant._id,
      session: {
        id: session._id,
        presentationId: session.presentationId,
        status: session.status,
      },
    };
  }
}

export const sessionService = new SessionService();
