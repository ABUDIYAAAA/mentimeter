import { Session, Slide } from "../src/core/database/models/index.js";

const sessionCache = new Map();
const slideCache = new Map();
const TTL_SESSION_MS = 5000;  // 5 seconds
const TTL_SLIDE_MS = 10000;   // 10 seconds

export async function getCachedSession(sessionId) {
  if (!sessionId) return null;
  const key = sessionId.toString();
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.timestamp < TTL_SESSION_MS) {
    return cached.data;
  }
  const session = await Session.findById(sessionId).lean();
  if (session) {
    sessionCache.set(key, { data: session, timestamp: Date.now() });
  }
  return session;
}

export function invalidateCachedSession(sessionId) {
  if (sessionId) {
    sessionCache.delete(sessionId.toString());
  }
}

export async function getCachedSlide(slideId) {
  if (!slideId) return null;
  const key = slideId.toString();
  const cached = slideCache.get(key);
  if (cached && Date.now() - cached.timestamp < TTL_SLIDE_MS) {
    return cached.data;
  }
  const slide = await Slide.findById(slideId).lean();
  if (slide) {
    slideCache.set(key, { data: slide, timestamp: Date.now() });
  }
  return slide;
}

export function invalidateCachedSlide(slideId) {
  if (slideId) {
    slideCache.delete(slideId.toString());
  }
}
