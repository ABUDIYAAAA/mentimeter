import express from "express";
import cors from "cors";
import morgan from "morgan";
import { createServer } from "node:http";
import env from "./src/core/env/env.js";
import { connectMongo } from "./src/core/database/connect.js";
import { initRealtimeServer } from "./realtime/server.js";

// Import Routes
import presentationRoutes from "./src/modules/presentation/presentation.routes.js";
import sessionRoutes from "./src/modules/session/session.routes.js";

const app = express();
const server = createServer(app);

initRealtimeServer(server);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

// Body Parser
app.use(express.json());
app.use(morgan("dev"));
// Mount API Routes
app.use("/api/presentations", presentationRoutes);
app.use("/api/sessions", sessionRoutes);

const [connection, error] = await connectMongo(env.MONGO_URI);

if (error) {
  console.error("MongoDB connection failed:", error);
  process.exit(1);
}

console.log("MongoDB connected");

server.listen(env.PORT, () => {
  console.log(`server running at ${env.PORT}`);
});
