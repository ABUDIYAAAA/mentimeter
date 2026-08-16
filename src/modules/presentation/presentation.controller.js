import { presentationService } from "./presentation.service.js";
import {
  createPresentationSchema,
  updatePresentationSchema,
  createSlideSchema,
  updateSlideSchema,
  reorderSlidesSchema,
} from "./presentation.schemas.js";

class PresentationController {
  // --- Presentations ---

  async createPresentation(req, res) {
    try {
      const validated = createPresentationSchema.parse({ body: req.body });
      const presentation = await presentationService.createPresentation(req.user._id, validated.body);
      res.status(201).json(presentation);
    } catch (error) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Validation Error", details: error.errors });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async getPresentations(req, res) {
    try {
      const presentations = await presentationService.getPresentations(req.user._id);
      res.status(200).json(presentations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getPresentationDetails(req, res) {
    try {
      const presentation = await presentationService.getPresentationDetails(req.params.id, req.user._id);
      res.status(200).json(presentation);
    } catch (error) {
      if (error.message === "Presentation not found") return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  async updatePresentation(req, res) {
    try {
      const validated = updatePresentationSchema.parse({ params: req.params, body: req.body });
      const updated = await presentationService.updatePresentation(validated.params.id, req.user._id, validated.body);
      res.status(200).json(updated);
    } catch (error) {
      if (error.name === "ZodError") return res.status(400).json({ error: "Validation Error", details: error.errors });
      if (error.message === "Presentation not found or unauthorized") return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  async deletePresentation(req, res) {
    try {
      await presentationService.deletePresentation(req.params.id, req.user._id);
      res.status(204).send();
    } catch (error) {
      if (error.message === "Presentation not found or unauthorized") return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  // --- Slides ---

  async createSlide(req, res) {
    try {
      const validated = createSlideSchema.parse({ params: req.params, body: req.body });
      const slide = await presentationService.createSlide(validated.params.id, req.user._id, validated.body);
      res.status(201).json(slide);
    } catch (error) {
      if (error.name === "ZodError") return res.status(400).json({ error: "Validation Error", details: error.errors });
      if (error.message === "Presentation not found or unauthorized") return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  async updateSlide(req, res) {
    try {
      const validated = updateSlideSchema.parse({ params: req.params, body: req.body });
      const slide = await presentationService.updateSlide(validated.params.id, validated.params.slideId, req.user._id, validated.body);
      res.status(200).json(slide);
    } catch (error) {
      if (error.name === "ZodError") return res.status(400).json({ error: "Validation Error", details: error.errors });
      if (error.message.includes("not found")) return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  async deleteSlide(req, res) {
    try {
      await presentationService.deleteSlide(req.params.id, req.params.slideId, req.user._id);
      res.status(204).send();
    } catch (error) {
      if (error.message.includes("not found")) return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  async reorderSlides(req, res) {
    try {
      const validated = reorderSlidesSchema.parse({ params: req.params, body: req.body });
      const slides = await presentationService.reorderSlides(validated.params.id, req.user._id, validated.body.slideIds);
      res.status(200).json(slides);
    } catch (error) {
      if (error.name === "ZodError") return res.status(400).json({ error: "Validation Error", details: error.errors });
      if (error.message === "Presentation not found or unauthorized") return res.status(404).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
}

export const presentationController = new PresentationController();
