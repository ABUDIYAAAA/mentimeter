import axios from "axios";
import crypto from "crypto";
import { User, Participant } from "../src/core/database/models/index.js";
import env from "../src/core/env/env.js";

// Helper to locally verify JWT HS256 signature
function verifyHS256JWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${headerB64}.${payloadB64}`);
    const expectedSignatureB64 = hmac.digest("base64url");

    if (signatureB64 !== expectedSignatureB64) return null;

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    // Verify expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) return null;

    return payload;
  } catch (err) {
    return null;
  }
}

const authCache = new Map();
const AUTH_CACHE_TTL = 30000; // 30 seconds cache for Socket.IO polling handshakes

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const { token } = socket.handshake.query;
    const sessionId = socket.handshake.query.sessionId || socket.handshake.auth?.sessionId;
    const cookie = socket.handshake.headers.cookie;
    const authHeader = socket.handshake.headers.authorization;

    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const participant = await Participant.findOne({ tokenHash }).lean();

      if (!participant || participant.status === "banned") {
        return next(
          new Error(
            "Authentication error: Invalid or banned participant token",
          ),
        );
      }

      socket.participant = participant;
      socket.data = {
        ...(socket.data || {}),
        participant,
        participantId: participant._id.toString(),
        sessionId: participant.sessionId.toString(),
        role: "participant",
      };
      return next();
    }

    // Host Authentication: via JWT cookie/header or via valid sessionId
    if (cookie || authHeader) {
      const cacheKey = cookie || authHeader;
      const cached = authCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < AUTH_CACHE_TTL) {
        socket.user = cached.user;
        socket.data = {
          ...(socket.data || {}),
          user: cached.user,
          userId: cached.user._id.toString(),
          sessionId: sessionId || null,
          role: "host",
        };
        return next();
      }

      try {
        let jwtToken = null;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          jwtToken = authHeader.substring(7);
        } else if (cookie) {
          const cookies = {};
          cookie.split(";").forEach((c) => {
            const parts = c.split("=");
            const name = parts[0]?.trim();
            const value = parts.slice(1).join("=").trim();
            if (name) {
              cookies[name] = decodeURIComponent(value);
            }
          });
          jwtToken = cookies["cf_jwt"] || cookies["better-auth.session_token"];
        }

        if (jwtToken) {
          const secret = env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || "default-secret-key-123456";
          const decoded = verifyHS256JWT(jwtToken, secret);

          if (decoded && decoded.id) {
            const externalUser = decoded;
            let localUser = await User.findOne({ externalId: externalUser.id });

            if (!localUser) {
              localUser = await User.create({
                externalId: externalUser.id,
                name: externalUser.name || externalUser.email || "Unknown User",
              });
            }

            authCache.set(cacheKey, { user: localUser, timestamp: Date.now() });

            if (authCache.size > 500) {
              const now = Date.now();
              for (const [k, v] of authCache.entries()) {
                if (now - v.timestamp > AUTH_CACHE_TTL) authCache.delete(k);
              }
            }

            socket.user = localUser;
            socket.data = {
              ...(socket.data || {}),
              user: localUser,
              userId: localUser._id.toString(),
              sessionId: sessionId || null,
              role: "host",
            };
            return next();
          }
        }
      } catch (authErr) {
        console.warn("[Socket Auth] Local JWT verification failed, falling back to sessionId lookup:", authErr.message);
      }
    }

    // Fallback: If sessionId is passed for a valid active session, authenticate as presenter
    if (sessionId) {
      const { Session } = await import("../src/core/database/models/index.js");
      const sessionDoc = await Session.findById(sessionId).lean();

      if (sessionDoc) {
        let hostUser = null;
        if (sessionDoc.presenterId) {
          hostUser = await User.findById(sessionDoc.presenterId).lean();
        }
        if (!hostUser) {
          hostUser = { _id: sessionDoc.presenterId, name: "Presenter" };
        }

        socket.user = hostUser;
        socket.data = {
          ...(socket.data || {}),
          user: hostUser,
          userId: hostUser._id ? hostUser._id.toString() : sessionDoc.presenterId?.toString(),
          sessionId: sessionDoc._id.toString(),
          role: "host",
        };
        return next();
      }
    }

    return next(new Error("Authentication error: No credentials provided"));
  } catch (error) {
    console.error("Socket Auth Error:", error);
    return next(new Error("Authentication error: Internal server error"));
  }
};
