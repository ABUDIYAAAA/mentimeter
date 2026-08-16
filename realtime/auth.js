import axios from "axios";
import crypto from "crypto";
import { User, Participant } from "../src/core/database/models/index.js";
import env from "../src/core/env/env.js";

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const { token } = socket.handshake.query;
    const cookie = socket.handshake.headers.cookie;
    const authHeader = socket.handshake.headers.authorization;

    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const participant = await Participant.findOne({ tokenHash }).lean();

      if (!participant || participant.status !== "active") {
        return next(
          new Error(
            "Authentication error: Invalid or inactive participant token",
          ),
        );
      }

      socket.participant = participant;
      return next();
    }

    if (cookie || authHeader) {
      try {
        const response = await axios.get(
          `${env.BETTER_AUTH_URL}/api/auth/get-session`,
          {
            headers: {
              ...(cookie ? { cookie } : {}),
              ...(authHeader ? { authorization: authHeader } : {}),
            },
          },
        );

        const sessionData = response.data;
        if (!sessionData || !sessionData.session || !sessionData.user) {
          return next(
            new Error("Authentication error: Invalid Better Auth session"),
          );
        }

        const externalUser = sessionData.user;
        let localUser = await User.findOne({ externalId: externalUser.id });

        if (!localUser) {
          localUser = await User.create({
            externalId: externalUser.id,
            name: externalUser.name || externalUser.email || "Unknown User",
          });
        }

        socket.user = localUser;
        return next();
      } catch (authErr) {
        return next(
          new Error("Authentication error: Better Auth validation failed"),
        );
      }
    }

    return next(new Error("Authentication error: No credentials provided"));
  } catch (error) {
    console.error("Socket Auth Error:", error);
    return next(new Error("Authentication error: Internal server error"));
  }
};
