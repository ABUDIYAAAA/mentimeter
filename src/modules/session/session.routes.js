import { Router } from "express";
import { sessionController } from "./session.controller.js";
import { requireAuth } from "../../core/middleware/auth.js";

const router = Router();

// --- Presenter Routes (Protected) ---
router.post("/", requireAuth, sessionController.createSession);

// --- Participant Routes (Public) ---
router.post("/:code/join", sessionController.joinSession);

export default router;
