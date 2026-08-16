import { z } from "zod";

// --- Presentation Schemas ---

export const createPresentationSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200),
    status: z.enum(["draft", "started", "deleted"]).optional(),
    settings: z
      .object({
        allowAnonymousParticipants: z.boolean().optional(),
        showResultsToParticipants: z.boolean().optional(),
      })
      .optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

export const updatePresentationSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Invalid Presentation ID"),
  }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    status: z.enum(["draft", "started", "deleted"]).optional(),
    settings: z
      .object({
        allowAnonymousParticipants: z.boolean().optional(),
        showResultsToParticipants: z.boolean().optional(),
      })
      .optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

// --- Slide Schemas ---

const slideTypes = ["select", "text", "multi_text", "multi_select", "rating"];

const optionSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  order: z.number().min(0),
});

const slideContentSchema = z.object({
  question: z.string().max(5000).optional(),
  options: z.array(optionSchema).optional(),
});

const slideSettingsSchema = z.object({
  allowMultipleResponses: z.boolean().optional(),
  showResults: z.boolean().optional(),
  randomizeOptions: z.boolean().optional(),
});

export const createSlideSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Invalid Presentation ID"),
  }),
  body: z.object({
    type: z.enum(slideTypes),
    position: z.number().min(0),
    title: z.string().max(500).optional(),
    content: slideContentSchema.optional(),
    settings: slideSettingsSchema.optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

export const updateSlideSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Invalid Presentation ID"),
    slideId: z.string().length(24, "Invalid Slide ID"),
  }),
  body: z.object({
    type: z.enum(slideTypes).optional(),
    position: z.number().min(0).optional(),
    title: z.string().max(500).optional(),
    content: slideContentSchema.optional(),
    settings: slideSettingsSchema.optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

export const reorderSlidesSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Invalid Presentation ID"),
  }),
  body: z.object({
    slideIds: z.array(z.string().length(24)),
  }),
});
