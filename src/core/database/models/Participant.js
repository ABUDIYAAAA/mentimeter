import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const ParticipantSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    nickname: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },

    tokenHash: {
      type: String,
      required: true,
      select: false,
    },

    status: {
      type: String,
      enum: [
        "active",
        "disconnected",
        "removed",
      ],
      default: "active",
      index: true,
    },

    socketId: {
      type: String,
      default: null,
      select: false,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },

    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    disconnectedAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

ParticipantSchema.index({
  sessionId: 1,
  joinedAt: 1,
});

ParticipantSchema.index({
  sessionId: 1,
  status: 1,
});

export const Participant = model(
  "Participant",
  ParticipantSchema
);
