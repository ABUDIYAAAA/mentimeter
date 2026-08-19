import "dotenv/config";
import z from "zod";

const envSchema = z.object({
  PORT: z.string(),
  MONGO_URI: z.string(),
  BETTER_AUTH_URL: z.string(),
  BETTER_AUTH_SECRET: z.string().optional(),
  REDIS_URI: z.string().optional(),
  WEB_URL: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_DOMAIN: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
});

const env = envSchema.parse(process.env);

export default env;
