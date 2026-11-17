import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { expireDueOrders } from "../src/services/expiry.js";
import {
  createEventHelper,
  placeOrderHelper,
  payOrderHelper,
} from "./helpers.js";

describe("order expiry", () => {
  it("expires overdue orders and restores quota exactly once", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 5 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-expiry-1",
      reg.id,
      3
    );

    const check1 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check1[0].available)).toBe(2);

    await db.execute(
      sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.id}`
    );

    await expireDueOrders();

    const orderRow = await db.execute<{ status: string }>(
      sql`SELECT status FROM orders WHERE id = ${order.id}`
    );
    expect(orderRow[0].status).toBe("expired");

    const check2 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check2[0].available)).toBe(5);

    await expireDueOrders();

    const check3 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check3[0].available)).toBe(5);
  });

  it("returns 409 ORDER_EXPIRED when paying an overdue order, issues no tickets, and restores quota once", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 5 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-expiry-2",
      reg.id,
      2
    );

    const check1 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check1[0].available)).toBe(3);

    await db.execute(
      sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.id}`
    );

    const { res: payRes1, data: payErr1 } = await payOrderHelper(order.id);
    expect(payRes1.status).toBe(409);
    expect(payErr1.error.code).toBe("ORDER_EXPIRED");

    const ticketCount = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(ticketCount[0].count)).toBe(0);

    const check2 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check2[0].available)).toBe(5);

    const { res: payRes2, data: payErr2 } = await payOrderHelper(order.id);
    expect(payRes2.status).toBe(409);
    expect(payErr2.error.code).toBe("ORDER_EXPIRED");

    const check3 = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(check3[0].available)).toBe(5);
  });
});
