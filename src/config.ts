import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  ORDER_TTL_MINUTES: z.coerce.number().default(15),
  WEBHOOK_SECRET: z.string().default("dev-webhook-secret"),
});

export const config = envSchema.parse(process.env);
