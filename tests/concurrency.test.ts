import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { createEventHelper, placeOrderHelper } from "./helpers.js";

describe("concurrency proof", () => {
  it("handles 200 simultaneous orders on quota 100 with exactly 100 successes and available 0", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 100 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const orders = Array.from({ length: 200 }, (_, i) =>
      placeOrderHelper(`buyer-concurrent-${i}`, reg.id, 1)
    );

    const results = await Promise.all(orders);

    const successCount = results.filter((r) => r.res.status === 201).length;
    const soldOutCount = results.filter(
      (r) => r.res.status === 409 && r.data?.error?.code === "SOLD_OUT"
    ).length;

    expect(successCount).toBe(100);
    expect(soldOutCount).toBe(100);

    const ttResult = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(ttResult[0].available)).toBe(0);
  });

  it("permits exactly 4 orders when one buyer fires 10 simultaneous quantity-1 orders on a quota-100 event", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 100 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const orders = Array.from({ length: 10 }, () =>
      placeOrderHelper("buyer-single-hammer", reg.id, 1)
    );

    const results = await Promise.all(orders);

    const successCount = results.filter((r) => r.res.status === 201).length;
    const limitExceededCount = results.filter(
      (r) => r.res.status === 409 && r.data?.error?.code === "LIMIT_EXCEEDED"
    ).length;

    expect(successCount).toBe(4);
    expect(limitExceededCount).toBe(6);
  });
});
