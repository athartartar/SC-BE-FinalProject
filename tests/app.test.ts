import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("health check", () => {
  it("returns ok when db responds", async () => {
    const mockDb = {
      execute: async () => [],
    } as any;

    const app = createApp(mockDb);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns error when db fails", async () => {
    const mockDb = {
      execute: async () => {
        throw new Error("DB down");
      },
    } as any;

    const app = createApp(mockDb);
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: "error" });
  });
});
