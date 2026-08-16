import { presentationRepository } from "./presentation.repository.js";
import { Slide } from "../../core/database/models/index.js"; // Needed for bulkWrite

class PresentationService {
  // --- Presentations ---

  async createPresentation(ownerId, data) {
    return presentationRepository.createPresentation({ ...data, ownerId });
  }

  async getPresentations(ownerId) {
    return presentationRepository.findPresentationsByOwner(ownerId);
  }

  async getPresentationDetails(id, ownerId) {
    const presentation = await presentationRepository.findPresentationByIdAndOwner(id, ownerId);
    if (!presentation) {
      throw new Error("Presentation not found");
    }

    const slides = await presentationRepository.findSlidesByPresentation(id);
    return { ...presentation, slides };
  }

  async updatePresentation(id, ownerId, data) {
    const updated = await presentationRepository.updatePresentation(id, ownerId, data);
    if (!updated) {
      throw new Error("Presentation not found or unauthorized");
    }
    return updated;
  }

  async deletePresentation(id, ownerId) {
    const deleted = await presentationRepository.deletePresentation(id, ownerId);
    if (!deleted) {
      throw new Error("Presentation not found or unauthorized");
    }

    // Cascade delete slides
    await presentationRepository.deleteSlidesByPresentation(id);
    return deleted;
  }

  // --- Slides ---

  async createSlide(presentationId, ownerId, data) {
    // Ensure user owns presentation before adding slide
    const presentation = await presentationRepository.findPresentationByIdAndOwner(presentationId, ownerId);
    if (!presentation) {
      throw new Error("Presentation not found or unauthorized");
    }

    return presentationRepository.createSlide({ ...data, presentationId });
  }

  async updateSlide(presentationId, slideId, ownerId, data) {
    // Verify ownership
    const presentation = await presentationRepository.findPresentationByIdAndOwner(presentationId, ownerId);
    if (!presentation) {
      throw new Error("Presentation not found or unauthorized");
    }

    const updated = await presentationRepository.updateSlide(slideId, presentationId, data);
    if (!updated) {
      throw new Error("Slide not found");
    }
    return updated;
  }

  async deleteSlide(presentationId, slideId, ownerId) {
    // Verify ownership
    const presentation = await presentationRepository.findPresentationByIdAndOwner(presentationId, ownerId);
    if (!presentation) {
      throw new Error("Presentation not found or unauthorized");
    }

    const deleted = await presentationRepository.deleteSlide(slideId, presentationId);
    if (!deleted) {
      throw new Error("Slide not found");
    }
    return deleted;
  }

  async reorderSlides(presentationId, ownerId, slideIds) {
    // Verify ownership
    const presentation = await presentationRepository.findPresentationByIdAndOwner(presentationId, ownerId);
    if (!presentation) {
      throw new Error("Presentation not found or unauthorized");
    }

    // Bulk update positions based on array index
    const bulkOps = slideIds.map((slideId, index) => ({
      updateOne: {
        filter: { _id: slideId, presentationId },
        update: { $set: { position: index } },
      },
    }));

    if (bulkOps.length > 0) {
      await Slide.bulkWrite(bulkOps);
    }

    return presentationRepository.findSlidesByPresentation(presentationId);
  }
}

export const presentationService = new PresentationService();
