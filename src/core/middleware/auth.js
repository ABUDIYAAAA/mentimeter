import axios from "axios";
import { User } from "../database/models/index.js";
import env from "../env/env.js";

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

    // --------------------------------------------------
    // 1. Get Better Auth session
    // --------------------------------------------------

    let authResponse;

    try {
      authResponse = await axios.get(
        `${env.BETTER_AUTH_URL}/api/auth/get-session`,
        {
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(authorization ? { authorization } : {}),
          },
          timeout: 5000,
        },
      );
    } catch (error) {
      console.error("[AUTH] Better Auth request FAILED");
      console.error("[AUTH]", error.message);
      console.error("[AUTH] status:", error.response?.status);
      console.error("[AUTH] body:", error.response?.data);

      return res.status(401).json({
        error: "Unauthorized: Authentication service failed",
      });
    }

    console.log("[AUTH] Better Auth status:", authResponse.status);

    const sessionData = authResponse.data;

    console.log("[AUTH] Better Auth session:", !!sessionData?.session);

    console.log("[AUTH] Better Auth user:", sessionData?.user?.id || null);

    // --------------------------------------------------
    // 2. Validate Better Auth response
    // --------------------------------------------------

    if (!sessionData?.session) {
      console.log("[AUTH] no session");

      return res.status(401).json({
        error: "Unauthorized: No active session",
      });
    }

    if (!sessionData?.user) {
      console.log("[AUTH] no user");

      return res.status(401).json({
        error: "Unauthorized: Session has no user",
      });
    }

    const externalUser = sessionData.user;

    console.log("[AUTH] authenticated external user:", externalUser.id);

    // --------------------------------------------------
    // 3. Find local user
    // --------------------------------------------------

    let localUser;

    try {
      localUser = await User.findOne({
        externalId: externalUser.id,
      });

      console.log(
        "[AUTH] local user:",
        localUser?._id?.toString() || "NOT FOUND",
      );
    } catch (error) {
      console.error("[AUTH] User.findOne FAILED");
      console.error(error);

      return res.status(500).json({
        error: "Internal server error while finding user",
      });
    }

    // --------------------------------------------------
    // 4. Create local user if necessary
    // --------------------------------------------------

    if (!localUser) {
      console.log("[AUTH] creating local user");

      try {
        localUser = await User.create({
          externalId: externalUser.id,
          name: externalUser.name || externalUser.email || "Unknown User",
        });

        console.log("[AUTH] local user created:", localUser._id?.toString());
      } catch (error) {
        console.error("[AUTH] User.create FAILED");
        console.error(error);

        return res.status(500).json({
          error: "Internal server error while creating user",
        });
      }
    }

    // --------------------------------------------------
    // 5. Attach identity
    // --------------------------------------------------

    req.user = localUser;

    req.auth = {
      user: externalUser,
      session: sessionData.session,
    };

    console.log("[AUTH] SUCCESS:", externalUser.id);

    return next();
  } catch (error) {
    console.error("[AUTH] UNEXPECTED ERROR");
    console.error(error);

    return res.status(500).json({
      error: "Internal server error in authentication middleware",
    });
  }
};
