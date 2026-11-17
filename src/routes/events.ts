import { Hono } from "hono";
import { z } from "zod";
import {
  createEvent,
  getEvents,
  getEventById,
} from "../services/events.js";

const createEventSchema = z.object({
  name: z.string().min(1),
  startsAt: z.coerce.date().refine((d) => !isNaN(d.getTime()), {
    message: "Invalid date",
  }),
  tickets: z.object({
    reguler: z.object({
      price: z.number().int().nonnegative(),
      quota: z.number().int().positive(),
    }),
    vip: z.object({
      price: z.number().int().nonnegative(),
      quota: z.number().int().positive(),
    }),
  }),
});

const idSchema = z.string().uuid();

export const eventsRouter = new Hono();

eventsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);

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

  const result = await createEvent(parsed.data);
  return c.json(result, 201);
});

eventsRouter.get("/", async (c) => {
  const result = await getEvents();
  return c.json(result);
});

eventsRouter.get("/:id", async (c) => {
  const idParam = c.req.param("id");
  const parsedId = idSchema.safeParse(idParam);

  if (!parsedId.success) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Event not found",
        },
      },
      404
    );
  }

  const result = await getEventById(parsedId.data);
  if (!result) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Event not found",
        },
      },
      404
    );
  }

  return c.json(result);
});
