import axios from "axios";
import { User } from "../database/models/index.js";
import env from "../env/env.js";

export const requireAuth = async (req, res, next) => {
  try {
    // Browser session cookie / optional bearer token
    const cookie = req.headers.cookie;
    const authorization = req.headers.authorization;

    if (!cookie && !authorization) {
      return res.status(401).json({
        error: "Unauthorized: No credentials provided",
      });
    }

    // Ask Better Auth to resolve the session.
    // Axios automatically parses the JSON response.
    const response = await axios.get(
      `${env.BETTER_AUTH_URL}/api/auth/get-session`,
      {
        headers: {
          ...(cookie && { Cookie: cookie }),
          ...(authorization && { Authorization: authorization }),
        },

        // Don't throw on 401/403 so we can handle invalid sessions ourselves.
        validateStatus: (status) => status >= 200 && status < 500,

        timeout: 5000,
      },
    );

    const sessionData = response.data;

    // Better Auth returned an HTTP error.
    if (response.status < 200 || response.status >= 300) {
      console.error("Better Auth returned:", response.status, sessionData);

      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    // No active session.
    if (!sessionData?.session || !sessionData?.user) {
      return res.status(401).json({
        error: "Unauthorized: Invalid or expired session",
      });
    }

    const externalUser = sessionData.user;

    if (!externalUser.id) {
      return res.status(401).json({
        error: "Unauthorized: Invalid user",
      });
    }

    // Find the corresponding local user.
    let localUser = await User.findOne({
      externalId: externalUser.id,
    });

    // Create the local user if this is their first request.
    if (!localUser) {
      localUser = await User.create({
        externalId: externalUser.id,
        name: externalUser.name || externalUser.email || "Unknown User",
      });
    }

    // Attach both local and external identity to the request.
    req.user = localUser;
    req.auth = {
      session: sessionData.session,
      user: externalUser,
    };

    return next();
  } catch (error) {
    // Never log cookies, Authorization headers, or session tokens.
    console.error("Auth Middleware Error:", {
      message: error.message,
      status: error.response?.status,
      response: error.response?.data,
    });

    if (error.code === "ECONNABORTED") {
      return res.status(401).json({
        error: "Unauthorized: Authentication service timeout",
      });
    }

    if (error.response) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(401).json({
      error: "Unauthorized",
    });
  }
};
