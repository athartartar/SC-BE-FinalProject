import { describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import {
  createEventHelper,
  placeOrderHelper,
  cancelOrderHelper,
} from "./helpers.js";

describe("validation and error handling", () => {
  it("returns 400 when X-Buyer-Id is missing", async () => {
    const resPost = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketTypeId: "00000000-0000-0000-0000-000000000000",
        quantity: 1,
      }),
    });
    expect(resPost.status).toBe(400);
    const errPost = await resPost.json();
    expect(errPost.error.code).toBe("BAD_REQUEST");

    const resGet = await app.request("/orders");
    expect(resGet.status).toBe(400);

    const resGetOne = await app.request(
      "/orders/00000000-0000-0000-0000-000000000000"
    );
    expect(resGetOne.status).toBe(400);

    const resCancel = await app.request(
      "/orders/00000000-0000-0000-0000-000000000000/cancel",
      { method: "POST" }
    );
    expect(resCancel.status).toBe(400);
  });

  it("returns 400 when quantity is 0 or 5", async () => {
    const { data: event } = await createEventHelper();
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { res: res0, data: err0 } = await placeOrderHelper(
      "buyer-val",
      reg.id,
      0
    );
    expect(res0.status).toBe(400);
    expect(err0.error.code).toBe("VALIDATION_ERROR");

    const { res: res5, data: err5 } = await placeOrderHelper(
      "buyer-val",
      reg.id,
      5
    );
    expect(res5.status).toBe(400);
    expect(err5.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 when cancelling another buyer order", async () => {
    const { data: event } = await createEventHelper();
    const reg = event.ticketTypes.find((t: any) => t.name === "Reguler");

    const { data: order } = await placeOrderHelper("owner-a", reg.id, 1);

    const { res: cancelRes, data: cancelErr } = await cancelOrderHelper(
      order.id,
      "wrong-owner-b"
    );
    expect(cancelRes.status).toBe(403);
    expect(cancelErr.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 for unknown ids", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";

    const resEvent = await app.request(`/events/${unknownId}`);
    expect(resEvent.status).toBe(404);
    const errEvent = await resEvent.json();
    expect(errEvent.error.code).toBe("NOT_FOUND");

    const resOrder = await app.request(`/orders/${unknownId}`, {
      headers: { "X-Buyer-Id": "buyer-val" },
    });
    expect(resOrder.status).toBe(404);

    const resCancel = await app.request(`/orders/${unknownId}/cancel`, {
      method: "POST",
      headers: { "X-Buyer-Id": "buyer-val" },
    });
    expect(resCancel.status).toBe(404);

    const resPay = await app.request(`/orders/${unknownId}/pay`, {
      method: "POST",
    });
    expect(resPay.status).toBe(404);

    const { res: resOrderPlace, data: errOrderPlace } =
      await placeOrderHelper("buyer-val", unknownId, 1);
    expect(resOrderPlace.status).toBe(404);
    expect(errOrderPlace.error.code).toBe("NOT_FOUND");
  });
});
