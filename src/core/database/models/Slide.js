import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

const OptionSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
    },

    text: {
      type: String,
      required: true,
      maxlength: 500,
    },

    order: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

const SlideSchema = new Schema(
  {
    presentationId: {
      type: Types.ObjectId,
      ref: "Presentation",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["select", "text", "multi_text", "multi_select", "rating"],
      required: true,
      index: true,
    },

    position: {
      type: Number,
      required: true,
      min: 0,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    content: {
      question: {
        type: String,
        trim: true,
        maxlength: 5000,
        default: "",
      },

      options: {
        type: [OptionSchema],
        default: [],
      },
    },

    settings: {
      allowMultipleResponses: {
        type: Boolean,
        default: false,
      },

      showResults: {
        type: Boolean,
        default: true,
      },

      randomizeOptions: {
        type: Boolean,
        default: false,
      },
    },

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

SlideSchema.index({
  presentationId: 1,
  position: 1,
});

SlideSchema.index({
  presentationId: 1,
  updatedAt: -1,
});

export const Slide = model("Slide", SlideSchema);
