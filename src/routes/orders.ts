import { Hono } from "hono";
import { z } from "zod";
import {
  createOrder,
  cancelOrder,
  payOrder,
  getOrdersByBuyer,
  getOrderById,
} from "../services/orders.js";

const createOrderSchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(4),
});

const idSchema = z.string().uuid();

export const ordersRouter = new Hono();

ordersRouter.post("/", async (c) => {
  const buyerId = c.req.header("x-buyer-id");
  if (!buyerId) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "X-Buyer-Id header is required",
        },
      },
      400
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);

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

  const result = await createOrder(
    buyerId,
    parsed.data.ticketTypeId,
    parsed.data.quantity
  );
  return c.json(result, 201);
});

ordersRouter.get("/", async (c) => {
  const buyerId = c.req.header("x-buyer-id");
  if (!buyerId) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "X-Buyer-Id header is required",
        },
      },
      400
    );
  }

  const result = await getOrdersByBuyer(buyerId);
  return c.json(result);
});

ordersRouter.get("/:id", async (c) => {
  const buyerId = c.req.header("x-buyer-id");
  if (!buyerId) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "X-Buyer-Id header is required",
        },
      },
      400
    );
  }

  const idParam = c.req.param("id");
  const parsedId = idSchema.safeParse(idParam);
  if (!parsedId.success) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Order not found",
        },
      },
      404
    );
  }

  const result = await getOrderById(buyerId, parsedId.data);
  return c.json(result);
});

ordersRouter.post("/:id/cancel", async (c) => {
  const buyerId = c.req.header("x-buyer-id");
  if (!buyerId) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "X-Buyer-Id header is required",
        },
      },
      400
    );
  }

  const idParam = c.req.param("id");
  const parsedId = idSchema.safeParse(idParam);
  if (!parsedId.success) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Order not found",
        },
      },
      404
    );
  }

  const result = await cancelOrder(buyerId, parsedId.data);
  return c.json(result);
});

ordersRouter.post("/:id/pay", async (c) => {
  const idParam = c.req.param("id");
  const parsedId = idSchema.safeParse(idParam);
  if (!parsedId.success) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Order not found",
        },
      },
      404
    );
  }

  const result = await payOrder(parsedId.data);
  return c.json(result);
});
