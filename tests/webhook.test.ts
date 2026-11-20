import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { expireDueOrders } from "../src/services/expiry.js";
import {
  createEventHelper,
  placeOrderHelper,
  sendWebhookHelper,
  getOrderHelper,
} from "./helpers.js";

describe("payment webhook", () => {
  it("pays and issues tickets when valid signature is provided", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 10 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-wh-1",
      reg.id,
      2
    );

    const { res, data } = await sendWebhookHelper({
      eventId: "evt-pay-1",
      orderId: order.id,
      status: "success",
    });

    expect(res.status).toBe(200);
    expect(data.outcome).toBe("PAID");

    const { data: updatedOrder } = await getOrderHelper(order.id, "buyer-wh-1");
    expect(updatedOrder.status).toBe("paid");
    expect(updatedOrder.tickets).toHaveLength(2);
    expect(updatedOrder.tickets[0].code).toMatch(/^TKT-/);

    const webhookRows = await db.execute<{ provider_event_id: string; outcome: string }>(
      sql`SELECT provider_event_id, outcome FROM webhook_events WHERE provider_event_id = 'evt-pay-1'`
    );
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows[0].outcome).toBe("PAID");
  });

  it("handles same eventId twice and 10 concurrent deliveries issuing tickets once", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 10 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-wh-concurrent",
      reg.id,
      2
    );

    const eventId = "evt-concurrent-10";
    const calls = Array.from({ length: 10 }, () =>
      sendWebhookHelper({
        eventId,
        orderId: order.id,
        status: "success",
      })
    );

    const results = await Promise.all(calls);
    for (const r of results) {
      expect(r.res.status).toBe(200);
      expect(r.data.outcome).toBe("PAID");
    }

    const { data: updatedOrder } = await getOrderHelper(
      order.id,
      "buyer-wh-concurrent"
    );
    expect(updatedOrder.status).toBe("paid");
    expect(updatedOrder.tickets).toHaveLength(2);

    const ticketRows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(ticketRows[0].count)).toBe(2);

    const repeatCall = await sendWebhookHelper({
      eventId,
      orderId: order.id,
      status: "success",
    });
    expect(repeatCall.res.status).toBe(200);
    expect(repeatCall.data.outcome).toBe("PAID");

    const ticketRowsAfter = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(ticketRowsAfter[0].count)).toBe(2);
  });

  it("issues nothing new for different eventId on already-paid order", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 10 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-wh-already-paid",
      reg.id,
      2
    );

    const first = await sendWebhookHelper({
      eventId: "evt-initial",
      orderId: order.id,
      status: "success",
    });
    expect(first.res.status).toBe(200);
    expect(first.data.outcome).toBe("PAID");

    const second = await sendWebhookHelper({
      eventId: "evt-different",
      orderId: order.id,
      status: "success",
    });
    expect(second.res.status).toBe(200);
    expect(second.data.outcome).toBe("ALREADY_PAID");

    const ticketRows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(ticketRows[0].count)).toBe(2);
  });

  it("issues nothing and does not restore quota again when webhook arrives after expiry", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 5 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper(
      "buyer-wh-expiry",
      reg.id,
      2
    );

    const checkAvailableBefore = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(checkAvailableBefore[0].available)).toBe(3);

    await db.execute(
      sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.id}`
    );

    await expireDueOrders();

    const checkAvailableAfterSweep = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(checkAvailableAfterSweep[0].available)).toBe(5);

    const { res, data } = await sendWebhookHelper({
      eventId: "evt-expired-order",
      orderId: order.id,
      status: "success",
    });

    expect(res.status).toBe(200);
    expect(data.outcome).toBe("LATE_NOT_ISSUED");

    const ticketRows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM tickets WHERE order_id = ${order.id}`
    );
    expect(Number(ticketRows[0].count)).toBe(0);

    const checkAvailableFinal = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${reg.id}`
    );
    expect(Number(checkAvailableFinal[0].available)).toBe(5);
  });

  it("returns 401 when signature is bad or missing", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 5 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");
    const { data: order } = await placeOrderHelper("buyer-wh-bad", reg.id, 1);

    const badSig = await sendWebhookHelper(
      {
        eventId: "evt-bad-sig",
        orderId: order.id,
        status: "success",
      },
      "wrong-secret"
    );
    expect(badSig.res.status).toBe(401);
    expect(badSig.data.error.code).toBe("UNAUTHORIZED");

    const missingSig = await sendWebhookHelper(
      {
        eventId: "evt-missing-sig",
        orderId: order.id,
        status: "success",
      },
      undefined,
      ""
    );
    expect(missingSig.res.status).toBe(401);
    expect(missingSig.data.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 and does not store webhook event when order is unknown", async () => {
    const unknownId = "11111111-1111-1111-1111-111111111111";
    const { res, data } = await sendWebhookHelper({
      eventId: "evt-unknown-order",
      orderId: unknownId,
      status: "success",
    });

    expect(res.status).toBe(404);
    expect(data.error.code).toBe("NOT_FOUND");

    const stored = await db.execute(
      sql`SELECT * FROM webhook_events WHERE provider_event_id = 'evt-unknown-order'`
    );
    expect(stored).toHaveLength(0);
  });

  it("stores RECORDED outcome and leaves order pending untouched when status is failed", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 5 });
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");
    const { data: order } = await placeOrderHelper("buyer-wh-failed", reg.id, 1);

    const { res, data } = await sendWebhookHelper({
      eventId: "evt-failed-status",
      orderId: order.id,
      status: "failed",
    });

    expect(res.status).toBe(200);
    expect(data.outcome).toBe("RECORDED");

    const { data: checkOrder } = await getOrderHelper(order.id, "buyer-wh-failed");
    expect(checkOrder.status).toBe("pending");
    expect(checkOrder.tickets).toHaveLength(0);
  });
});
