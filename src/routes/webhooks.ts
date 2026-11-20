import { Hono } from "hono";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { processPaymentWebhook } from "../services/orders.js";

const webhookBodySchema = z.object({
  eventId: z.string().min(1),
  orderId: z.string().uuid(),
  status: z.enum(["success", "failed"]),
});

export const webhooksRouter = new Hono();

webhooksRouter.post("/payment", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-signature") || "";

  const expectedSignature = crypto
    .createHmac("sha256", config.WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const normalizedSignature = signature.startsWith("sha256=")
    ? signature.slice(7)
    : signature;

  const actualBuffer = Buffer.from(normalizedSignature, "utf-8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid signature",
        },
      },
      401
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid JSON body",
        },
      },
      400
    );
  }

  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => i.message).join(", "),
        },
      },
      400
    );
  }

  const result = await processPaymentWebhook(parsed.data);
  return c.json(result, 200);
});
