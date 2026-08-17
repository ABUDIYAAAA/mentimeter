import { Session, Slide } from "../../src/core/database/models/index.js";
import { syncer } from "../syncer.js";
import { wipePresentationSessionData } from "../../src/modules/session/session.service.js";
import { invalidateCachedSession, invalidateCachedSlide } from "../cache.js";

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

export const handleSessionStatusChange = async (socket, { status }) => {
  const validStatuses = ["waiting", "live", "paused", "finished"];
  if (!validStatuses.includes(status)) {
    throw new Error(
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
    );
  }

  const session = await verifyHost(socket);

  if (status === "waiting") {
    await wipePresentationSessionData(session.presentationId);
    const slides = await Slide.find({ presentationId: session.presentationId }).lean();
    for (const slide of slides) {
      await syncer.broadcastSlideAnalytics(socket.sessionId, slide._id, slide.type);
    }
  }

  const updateFields = {
    $set: { status, lastActivityAt: new Date() },
    $inc: { version: 1, eventSequence: 1 },
  };

  if (status === "live" && !session.startedAt) {
    updateFields.$set.startedAt = new Date();
  } else if (status === "paused") {
    updateFields.$set.pausedAt = new Date();
  } else if (status === "finished") {
    updateFields.$set.endedAt = new Date();
  }

  await Session.findByIdAndUpdate(socket.sessionId, updateFields);
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

  const session = await verifyHost(socket);

  await Session.findByIdAndUpdate(socket.sessionId, {
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

  await Session.findByIdAndUpdate(socket.sessionId, {
    $set: {
      currentSlideId: slideId,
      currentSlidePosition: targetSlide.order,
      isVotingLocked: false, // Auto-reset the lock when changing slides!
      lastActivityAt: new Date(),
    },
    $inc: { version: 1, eventSequence: 1 },
  });
  invalidateCachedSession(socket.sessionId);
  invalidateCachedSlide(slideId);

  console.log(
    `[WS Host] Session ${socket.sessionId} changed to slide: ${slideId}`,
  );

  await syncer.broadcastState(socket.sessionId, true);

  return { currentSlideId: slideId, order: targetSlide.order };
};
