import crypto from "crypto";
import {
  Session,
  Slide,
  Response,
} from "../../src/core/database/models/index.js";
import { syncer } from "../syncer.js";

export const handleSubmitResponse = async (socket, { slideId, answer }) => {
  if (!socket.participant) {
    throw new Error("Unauthorized: Only participants can submit responses");
  }

  const participantId = socket.participant._id;
  const sessionId = socket.sessionId;

  const session = await Session.findById(sessionId).lean();
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.status !== "live") {
    throw new Error("Cannot submit response: The session is not live");
  }

  const slide = await Slide.findById(slideId).lean();
  if (!slide) {
    throw new Error("Slide not found");
  }

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Answer must be a non-empty string");
  }
  const cleanAnswer = answer.trim();

  const commandId = crypto.randomUUID();

  switch (slide.type) {
    case "text": {
      const exists = await Response.exists({
        sessionId,
        slideId,
        participantId,
      });
      if (exists) {
        throw new Error("You have already submitted a response for this slide");
      }

      await Response.create({
        sessionId,
        presentationId: session.presentationId,
        slideId,
        participantId,
        type: "text",
        answer: {
          text: cleanAnswer,
        },
        commandId,
      });
      break;
    }

    case "multi_text": {
      const existingResponse = await Response.findOne({
        sessionId,
        slideId,
        participantId,
      });

      if (existingResponse) {
        await Response.updateOne(
          { _id: existingResponse._id },
          {
            $push: { "answer.raw": cleanAnswer },
            $set: { commandId },
          },
        );
      } else {
        await Response.create({
          sessionId,
          presentationId: session.presentationId,
          slideId,
          participantId,
          type: "multi_text",
          answer: {
            raw: [cleanAnswer],
          },
          commandId,
        });
      }
      break;
    }

    case "select":
    case "multi_select":
    case "rating":
      throw new Error(
        `Slide type '${slide.type}' is not yet configured for submission`,
      );

    default:
      throw new Error(`Unsupported slide type: ${slide.type}`);
  }

  console.log(
    `[WS Participant] Response submitted by ${participantId} for slide ${slideId}`,
  );

  await syncer.broadcastSlideAnalytics(sessionId, slideId, slide.type);

  return { success: true };
};
