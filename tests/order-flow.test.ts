import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  createEventHelper,
  placeOrderHelper,
  payOrderHelper,
  getOrdersHelper,
} from "./helpers.js";

describe("order flow", () => {
  it("creates event, places order, pays, issues tickets, and handles idempotency", async () => {
    const { res: eventRes, data: event } = await createEventHelper({
      regulerQuota: 5,
    });
    expect(eventRes.status).toBe(201);
    expect(typeof event.createdAt).toBe("string");
    expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt);

    const regulerType = event.ticketTypes.find(
      (t: any) => t.name === "Reguler"
    );

    const { res: orderRes, data: order } = await placeOrderHelper(
      "buyer-flow",
      regulerType.id,
      3
    );
    expect(orderRes.status).toBe(201);
    expect(order.status).toBe("pending");
    expect(order.quantity).toBe(3);
    expect(new Date(order.expiresAt).toISOString()).toBe(order.expiresAt);
    expect(new Date(order.createdAt).toISOString()).toBe(order.createdAt);
    expect(order.paidAt).toBeNull();

    const { res: payRes1, data: paidOrder1 } = await payOrderHelper(order.id);
    expect(payRes1.status).toBe(200);
    expect(paidOrder1.status).toBe("paid");
    expect(new Date(paidOrder1.paidAt).toISOString()).toBe(paidOrder1.paidAt);
    expect(paidOrder1.tickets).toHaveLength(3);

    const codes1 = paidOrder1.tickets.map((t: any) => t.code);
    expect(new Set(codes1).size).toBe(3);
    for (const code of codes1) {
      expect(code).toMatch(/^TKT-[0-9A-F]{10}$/);
    }

    const { res: getRes, data: ordersList } =
      await getOrdersHelper("buyer-flow");
    expect(getRes.status).toBe(200);
    expect(ordersList).toHaveLength(1);
    expect(ordersList[0].id).toBe(order.id);
    expect(ordersList[0].tickets).toHaveLength(3);
    expect(ordersList[0].ticketCodes).toEqual(codes1);

    const { res: payRes2, data: paidOrder2 } = await payOrderHelper(order.id);
    expect(payRes2.status).toBe(200);
    expect(paidOrder2.status).toBe("paid");
    const codes2 = paidOrder2.tickets.map((t: any) => t.code);
    expect(codes2).toEqual(codes1);

    const countResult = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(countResult[0].count)).toBe(3);
  });
});
