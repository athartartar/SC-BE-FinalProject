import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("routes validation", () => {
  it("rejects orders without X-Buyer-Id", async () => {
    const app = createApp({ execute: async () => [] } as any);
    const res = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketTypeId: "513ed006-184f-4e39-a0b4-4acfcfc7611c",
        quantity: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "X-Buyer-Id header is required",
      },
    });
  });

  it("validates quantity between 1 and 4", async () => {
    const app = createApp({ execute: async () => [] } as any);
    const res = await app.request("/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buyer-Id": "buyer-1",
      },
      body: JSON.stringify({
        ticketTypeId: "513ed006-184f-4e39-a0b4-4acfcfc7611c",
        quantity: 5,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for invalid event id", async () => {
    const app = createApp({ execute: async () => [] } as any);
    const res = await app.request("/events/not-a-uuid");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Event not found",
      },
    });
  });
});
