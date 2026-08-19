import crypto from "crypto";
import { User } from "../database/models/index.js";
import env from "../env/env.js";

// Lightweight, dependency-free JWT verification helper using Node's native crypto module
function verifyHS256JWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${headerB64}.${payloadB64}`);
    const expectedSignatureB64 = hmac.digest("base64url");

    if (signatureB64 !== expectedSignatureB64) {
      console.error("[AUTH] JWT signature verification failed");
      return null;
    }

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    // Verify expiration
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      console.error("[AUTH] JWT token expired");
      return null;
    }

    return payload;
  } catch (err) {
    console.error("[AUTH] JWT verification error:", err);
    return null;
  }
}

export const requireAuth = async (req, res, next) => {
  console.log("[AUTH] middleware entered:", req.method, req.originalUrl);

  try {
    const cookie = req.headers.cookie;
    const authorization = req.headers.authorization;

    if (!cookie && !authorization) {
      console.log("[AUTH] no credentials");
      return res.status(401).json({
        error: "Unauthorized: No credentials provided",
      });
    }

    console.log("[AUTH] credentials received");

    // 1. Extract token from cookie or authorization header
    let token = null;

    if (authorization && authorization.startsWith("Bearer ")) {
      token = authorization.substring(7);
    } else if (cookie) {
      const cookies = {};
      cookie.split(";").forEach((c) => {
        const parts = c.split("=");
        const name = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        if (name) {
          cookies[name] = decodeURIComponent(value);
        }
      });
      token = cookies["cf_jwt"] || cookies["better-auth.session_token"];
    }

    if (!token) {
      console.log("[AUTH] no token found in cookies or authorization headers");
      return res.status(401).json({
        error: "Unauthorized: No active token found",
      });
    }

    // 2. Local JWT validation using the shared BETTER_AUTH_SECRET (or JWT_SECRET)
    const secret = env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || "default-secret-key-123456";
    const decoded = verifyHS256JWT(token, secret);

    if (!decoded || !decoded.id) {
      console.log("[AUTH] token verification failed");
      return res.status(401).json({
        error: "Unauthorized: Invalid or expired token",
      });
    }

    console.log("[AUTH] authenticated user ID:", decoded.id);

    // 3. Find local user
    let localUser;
    try {
      localUser = await User.findOne({
        externalId: decoded.id,
      });

      console.log(
        "[AUTH] local user:",
        localUser?._id?.toString() || "NOT FOUND",
      );
    } catch (error) {
      console.error("[AUTH] User.findOne FAILED", error);
      return res.status(500).json({
        error: "Internal server error while finding user",
      });
    }

    // 4. Create local user if necessary
    if (!localUser) {
      console.log("[AUTH] creating local user");
      try {
        localUser = await User.create({
          externalId: decoded.id,
          name: decoded.name || decoded.email || "Unknown User",
        });
        console.log("[AUTH] local user created:", localUser._id?.toString());
      } catch (error) {
        console.error("[AUTH] User.create FAILED", error);
        return res.status(500).json({
          error: "Internal server error while creating user",
        });
      }
    }

    // 5. Attach identity
    req.user = localUser;
    req.auth = {
      user: {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
      },
      session: {
        id: decoded.id,
        userId: decoded.id,
      },
    };

    console.log("[AUTH] SUCCESS:", decoded.id);
    return next();
  } catch (error) {
    console.error("[AUTH] UNEXPECTED ERROR", error);
    return res.status(500).json({
      error: "Internal server error in authentication middleware",
    });
  }
};
