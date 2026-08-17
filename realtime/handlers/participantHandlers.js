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
  if (session.isVotingLocked) {
    throw new Error("Voting is currently locked for this session");
  }

  // 4. Fetch slide details to verify type and configuration
  const slide = await Slide.findById(slideId).lean();
  if (!slide) {
    throw new Error("Slide not found");
  }

  // Generate a fallback commandId if not provided (required by Schema)
  const commandId = crypto.randomUUID();

  // 5. Handle type-specific submission logic
  switch (slide.type) {
    case "BAR_GRAPH":
    case "select":
    case "multi_select": {
      let optionIds = [];
      if (Array.isArray(answer)) {
        optionIds = answer;
      } else if (typeof answer === "string" && answer.trim()) {
        optionIds = [answer.trim()];
      } else {
        throw new Error("Answer must be a selected option ID or array of IDs");
      }

      // Check for double voting
      const exists = await Response.exists({ sessionId, slideId, participantId });
      if (exists) {
        throw new Error("You have already submitted a response for this slide");
      }

      await Response.create({
        sessionId,
        presentationId: session.presentationId,
        slideId,
        participantId,
        type: "select",
        answer: { optionIds },
        commandId,
      });

      // Update voteCount on slide options in DB
      if (optionIds.length > 0) {
        await Slide.updateOne(
          { _id: slideId },
          { $inc: { "options.$[elem].voteCount": 1 } },
          { arrayFilters: [{ "elem.id": { $in: optionIds } }] }
        );
      }
      break;
    }

    case "WORD_CLOUD":
    case "text":
    case "multi_text": {
      let words = [];
      if (Array.isArray(answer)) {
        words = answer
          .map((w) => (typeof w === "string" ? w.trim() : String(w).trim()))
          .filter((w) => w.length > 0);
      } else if (typeof answer === "string" && answer.trim()) {
        words = [answer.trim()];
      }

      if (words.length === 0) {
        throw new Error("Answer must contain at least one non-empty word");
      }

      const isUnlimited = Boolean(
        slide.responseSettings?.multipleSubmissions === true ||
        slide.responseSettings?.maxEntriesPerParticipant === 0
      );

      if (!isUnlimited) {
        const exists = await Response.exists({ sessionId, slideId, participantId });
        if (exists) {
          throw new Error("You have already submitted a response for this slide");
        }
      }

      await Response.create({
        sessionId,
        presentationId: session.presentationId,
        slideId,
        participantId,
        type: "text",
        answer: {
          text: words.join(", "),
          raw: words,
        },
        commandId,
      });
      break;
    }

    case "SCALES":
    case "rating": {
      const exists = await Response.exists({ sessionId, slideId, participantId });
      if (exists) {
        throw new Error("You have already submitted a response for this slide");
      }

      if (typeof answer === "number") {
        await Response.create({
          sessionId,
          presentationId: session.presentationId,
          slideId,
          participantId,
          type: "rating",
          answer: { rating: answer, raw: answer },
          commandId,
        });
      } else if (typeof answer === "object" && answer !== null) {
        await Response.create({
          sessionId,
          presentationId: session.presentationId,
          slideId,
          participantId,
          type: "rating",
          answer: { raw: answer },
          commandId,
        });
      } else if (typeof answer === "string" && !isNaN(Number(answer))) {
        const num = Number(answer);
        await Response.create({
          sessionId,
          presentationId: session.presentationId,
          slideId,
          participantId,
          type: "rating",
          answer: { rating: num, raw: num },
          commandId,
        });
      } else {
        throw new Error("Answer must be a valid rating number or object");
      }
      break;
    }

    case "CONTENT": {
      break;
    }

    default:
      throw new Error(`Unsupported slide type: ${slide.type}`);
  }

  console.log(
    `[WS Participant] Response submitted by ${participantId} for slide ${slideId}`,
  );

  await syncer.broadcastSlideAnalytics(sessionId, slideId, slide.type);

  return { success: true };
};
