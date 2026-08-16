import express from "express";
import { createServer } from "node:http";
import env from "./src/core/env/env.js";
import { connectMongo } from "./src/core/database/connect.js";
import { requireAuth } from "./src/core/middleware/auth.js";
import cors from "cors";
const app = express();
const server = createServer(app);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

const [connection, error] = await connectMongo(env.MONGO_URI);

if (error) {
  console.error("MongoDB connection failed:", error);
  process.exit(1);
}

console.log("MongoDB connected");

server.listen(env.PORT, () => {
  console.log(`server running at ${env.PORT}`);
});
