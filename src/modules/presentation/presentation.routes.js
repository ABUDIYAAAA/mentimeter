import { Router } from "express";
import { presentationController } from "./presentation.controller.js";
import { requireAuth } from "../../core/middleware/auth.js";

const router = Router();

// Public presentation route for audience/participants (no auth required)
router.get("/public/:id", presentationController.getPublicPresentationDetails);

// Secure remaining presentation routes with the Better Auth middleware
router.use(requireAuth);

// --- Presentations ---
router.post("/", presentationController.createPresentation);
router.get("/", presentationController.getPresentations);
router.get("/:id", presentationController.getPresentationDetails);
router.patch("/:id", presentationController.updatePresentation);
router.delete("/:id", presentationController.deletePresentation);

// --- Slides ---
router.post("/:id/slides", presentationController.createSlide);
router.patch("/:id/slides/reorder", presentationController.reorderSlides);
router.patch("/:id/slides/:slideId", presentationController.updateSlide);
router.delete("/:id/slides/:slideId", presentationController.deleteSlide);

export default router;
