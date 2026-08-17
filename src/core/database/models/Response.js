import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const ResponseSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    presentationId: {
      type: Types.ObjectId,
      ref: "Presentation",
      required: true,
      index: true,
    },

    slideId: {
      type: Types.ObjectId,
      ref: "Slide",
      required: true,
      index: true,
    },

    participantId: {
      type: Types.ObjectId,
      ref: "Participant",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["select", "text", "multi_text", "multi_select", "rating"],
      required: true,
    },

    answer: {
      optionIds: {
        type: [String],
        default: [],
      },

      text: {
        type: String,
        default: null,
        maxlength: 10000,
      },

      rating: {
        type: Number,
        default: null,
      },

      raw: {
        type: Schema.Types.Mixed,
        default: null,
      },
    },

    submittedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    updatedAtClient: {
      type: Date,
      default: null,
    },

    commandId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

ResponseSchema.index(
  {
    sessionId: 1,
    slideId: 1,
    participantId: 1,
    commandId: 1,
  },
  {
    unique: true,
  },
);

ResponseSchema.index({
  sessionId: 1,
  slideId: 1,
  participantId: 1,
});

ResponseSchema.index({
  slideId: 1,
  submittedAt: -1,
});

export const Response = model("Response", ResponseSchema);
