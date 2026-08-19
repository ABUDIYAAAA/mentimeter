import axios from "axios";
import { User } from "../database/models/index.js";
import env from "../env/env.js";

export const requireAuth = async (req, res, next) => {
  try {
    const cookie = req.headers.cookie;
    const authHeader = req.headers.authorization;

    if (!cookie && !authHeader) {
      return res
        .status(401)
        .json({ error: "Unauthorized: No credentials provided" });
    }

    const response = await axios.get(
      `${env.BETTER_AUTH_URL}/api/auth/get-session`,
      {
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(authHeader ? { authorization: authHeader } : {}),
        },
      },
    );

    console.log(cookie);
    console.log(authHeader);

    const sessionData = response.data;
    console.log(sessionData);
    console.log("cookie:", req.headers.cookie);
    console.log("authorization:", req.headers.authorization);
    console.log("auth url:", env.BETTER_AUTH_URL);
    console.log(data);

    if (!sessionData || !sessionData.session || !sessionData.user) {
      return res.status(401).json({ error: "Unauthorized: Invalid session" });
    }

    const externalUser = sessionData.user;

    let localUser = await User.findOne({ externalId: externalUser.id });

    if (!localUser) {
      localUser = await User.create({
        externalId: externalUser.id,
        name: externalUser.name || externalUser.email || "Unknown User",
      });
    }

    req.user = localUser;

    next();
  } catch (error) {
    console.error(
      "Auth Middleware Error:",
      error?.response?.data || error.message,
    );
    return res.status(401).json({ error: "Unauthorized" });
  }
};
