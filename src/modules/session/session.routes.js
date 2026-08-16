import { Router } from "express";
import { sessionController } from "./session.controller.js";
import { requireAuth } from "../../core/middleware/auth.js";

import { rateLimitMiddleware } from "../../core/middleware/rateLimiter.js";

const router = Router();

// --- Presenter Routes (Protected) ---
router.post("/", requireAuth, sessionController.createSession);

// --- Participant Routes (Public) ---
// Apply strict leaky bucket rate limit to prevent spamming the join code
router.post("/:code/join", rateLimitMiddleware({ action: "http_join", capacity: 5, leakRate: 1 }), sessionController.joinSession);

export default router;
