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
    case "text": {
      if (typeof answer !== "string" || !answer.trim()) {
        throw new Error("Answer must be a non-empty string");
      }
      const cleanAnswer = answer.trim();

      const exists = await Response.exists({ sessionId, slideId, participantId });
      if (exists) {
        throw new Error("You have already submitted a response for this slide");
      }

      await Response.create({
        sessionId,
        presentationId: session.presentationId,
        slideId,
        participantId,
        type: "text",
        answer: { text: cleanAnswer },
        commandId,
      });
      break;
    }

    case "multi_text": {
      if (typeof answer !== "string" || !answer.trim()) {
        throw new Error("Answer must be a non-empty string");
      }
      const cleanAnswer = answer.trim();

      const existingResponse = await Response.findOne({ sessionId, slideId, participantId });

      if (existingResponse) {
        await Response.updateOne(
          { _id: existingResponse._id },
          { 
            $push: { "answer.raw": cleanAnswer },
            $set: { commandId }
          }
        );
      } else {
        await Response.create({
          sessionId,
          presentationId: session.presentationId,
          slideId,
          participantId,
          type: "multi_text",
          answer: { raw: [cleanAnswer] },
          commandId,
        });
      }
      break;
    }

    case "select":
    case "multi_select": {
      const isMulti = slide.type === "multi_select";
      let optionIds = [];

      if (isMulti) {
        if (!Array.isArray(answer) || answer.length === 0) {
          throw new Error("Answer must be an array of selected option IDs");
        }
        optionIds = answer;
      } else {
        if (typeof answer !== "string" || !answer.trim()) {
          throw new Error("Answer must be a string containing the selected option ID");
        }
        optionIds = [answer.trim()];
      }

      // Validate that all submitted optionIds actually exist on the slide
      const validOptionIds = slide.content.options.map(opt => opt.id);
      const allValid = optionIds.every(id => validOptionIds.includes(id));
      if (!allValid) {
        throw new Error("One or more selected options are invalid");
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
        type: slide.type,
        answer: { optionIds },
        commandId,
      });
      break;
    }

    case "rating": {
      if (typeof answer !== "object" || Array.isArray(answer) || answer === null) {
        throw new Error("Answer must be an object containing ratings for each option");
      }

      const validOptionIds = slide.content.options.map((opt) => opt.id);
      
      for (const [optionId, ratingVal] of Object.entries(answer)) {
        if (!validOptionIds.includes(optionId)) {
          throw new Error(`Invalid option ID: ${optionId}`);
        }
        if (typeof ratingVal !== "number") {
          throw new Error(`Rating for ${optionId} must be a number`);
        }
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
        type: "rating",
        answer: { raw: answer }, // Store ratings as a raw mapping
        commandId,
      });
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
