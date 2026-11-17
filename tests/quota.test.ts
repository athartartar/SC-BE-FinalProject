import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  createEventHelper,
  placeOrderHelper,
  cancelOrderHelper,
  payOrderHelper,
  getEventHelper,
} from "./helpers.js";

describe("quota and buyer limits", () => {
  it("returns 409 SOLD_OUT when quota is insufficient and available is never negative", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 2 });
    const regulerType = event.ticketTypes.find(
      (t: any) => t.name === "Reguler"
    );

    const { res: orderRes1 } = await placeOrderHelper(
      "buyer-1",
      regulerType.id,
      2
    );
    expect(orderRes1.status).toBe(201);

    const { res: orderRes2, data: orderErr } = await placeOrderHelper(
      "buyer-2",
      regulerType.id,
      1
    );
    expect(orderRes2.status).toBe(409);
    expect(orderErr.error.code).toBe("SOLD_OUT");

    const ttResult = await db.execute<{ available: number }>(
      sql`SELECT available FROM ticket_types WHERE id = ${regulerType.id}`
    );
    expect(Number(ttResult[0].available)).toBe(0);
  });

  it("restores quota immediately on cancel and returns 409 on second cancel", async () => {
    const { data: event } = await createEventHelper({ regulerQuota: 3 });
    const regulerType = event.ticketTypes.find(
      (t: any) => t.name === "Reguler"
    );

    const { data: order } = await placeOrderHelper(
      "buyer-cancel",
      regulerType.id,
      2
    );

    const { data: eventAfterOrder } = await getEventHelper(event.id);
    const regAfterOrder = eventAfterOrder.ticketTypes.find(
      (t: any) => t.name === "Reguler"
    );
    expect(regAfterOrder.available).toBe(1);

    const { res: cancelRes1, data: cancelled } = await cancelOrderHelper(
      order.id,
      "buyer-cancel"
    );
    expect(cancelRes1.status).toBe(200);
    expect(cancelled.status).toBe("cancelled");

    const { data: eventAfterCancel } = await getEventHelper(event.id);
    const regAfterCancel = eventAfterCancel.ticketTypes.find(
      (t: any) => t.name === "Reguler"
    );
    expect(regAfterCancel.available).toBe(3);

    const { res: cancelRes2, data: cancelErr } = await cancelOrderHelper(
      order.id,
      "buyer-cancel"
    );
    expect(cancelRes2.status).toBe(409);
    expect(cancelErr.error.code).toBe("ORDER_NOT_PENDING");
  });

  it("enforces max 4 tickets per buyer per event across pending+paid, while another event is unaffected and cancelled orders do not count", async () => {
    const { data: eventA } = await createEventHelper({
      name: "Event A",
      regulerQuota: 10,
    });
    const regA = eventA.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order1 } = await placeOrderHelper("buyer-limit", regA.id, 2);
    await payOrderHelper(order1.id, "buyer-limit");

    const { res: orderRes2 } = await placeOrderHelper(
      "buyer-limit",
      regA.id,
      2
    );
    expect(orderRes2.status).toBe(201);

    const { res: orderRes3, data: errLimit } = await placeOrderHelper(
      "buyer-limit",
      regA.id,
      1
    );
    expect(orderRes3.status).toBe(409);
    expect(errLimit.error.code).toBe("LIMIT_EXCEEDED");

    const { data: eventB } = await createEventHelper({
      name: "Event B",
      regulerQuota: 10,
    });
    const regB = eventB.ticketTypes.find((t: any) => t.name === "Reguler");

    const { res: orderResB } = await placeOrderHelper(
      "buyer-limit",
      regB.id,
      4
    );
    expect(orderResB.status).toBe(201);

    const { data: eventC } = await createEventHelper({
      name: "Event C",
      regulerQuota: 10,
    });
    const regC = eventC.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: orderC1 } = await placeOrderHelper(
      "buyer-limit",
      regC.id,
      4
    );
    const { res: cancelC } = await cancelOrderHelper(
      orderC1.id,
      "buyer-limit"
    );
    expect(cancelC.status).toBe(200);

    const { res: orderC2 } = await placeOrderHelper(
      "buyer-limit",
      regC.id,
      4
    );
    expect(orderC2.status).toBe(201);
  });
});
