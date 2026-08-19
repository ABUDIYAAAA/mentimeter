import "dotenv/config";
import z from "zod";

const envSchema = z.object({
  PORT: z.string(),
  MONGO_URI: z.string(),
  BETTER_AUTH_URL: z.string(),
  BETTER_AUTH_SECRET: z.string().optional(),
  REDIS_URI: z.string().optional(),
  WEB_URL: z.string().optional(),
});

const env = envSchema.parse(process.env);

export default env;
