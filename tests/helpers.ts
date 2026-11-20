import crypto from "node:crypto";
import { app } from "../src/app.js";
import { config } from "../src/config.js";

export async function createEventHelper(
  options: {
    name?: string;
    regulerQuota?: number;
    vipQuota?: number;
    regulerPrice?: number;
    vipPrice?: number;
    startsAt?: string;
  } = {}
) {
  const res = await app.request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: options.name || "Test Concert",
      startsAt: options.startsAt || "2026-12-01T10:00:00.000Z",
      tickets: {
        reguler: {
          price: options.regulerPrice ?? 100000,
          quota: options.regulerQuota ?? 5,
        },
        vip: {
          price: options.vipPrice ?? 250000,
          quota: options.vipQuota ?? 2,
        },
      },
    }),
  });
  const data = await res.json();
  return { res, data };
}

export async function placeOrderHelper(
  buyerId: string,
  ticketTypeId: string,
  quantity: number
) {
  const res = await app.request("/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Buyer-Id": buyerId,
    },
    body: JSON.stringify({ ticketTypeId, quantity }),
  });
  const data = await res.json();
  return { res, data };
}

export async function payOrderHelper(orderId: string, buyerId?: string) {
  const headers: Record<string, string> = {};
  if (buyerId) headers["X-Buyer-Id"] = buyerId;
  const res = await app.request(`/orders/${orderId}/pay`, {
    method: "POST",
    headers,
  });
  const data = await res.json();
  return { res, data };
}

export async function cancelOrderHelper(orderId: string, buyerId: string) {
  const res = await app.request(`/orders/${orderId}/cancel`, {
    method: "POST",
    headers: { "X-Buyer-Id": buyerId },
  });
  const data = await res.json();
  return { res, data };
}

export async function getOrdersHelper(buyerId: string) {
  const res = await app.request("/orders", {
    headers: { "X-Buyer-Id": buyerId },
  });
  const data = await res.json();
  return { res, data };
}

export async function getOrderHelper(orderId: string, buyerId: string) {
  const res = await app.request(`/orders/${orderId}`, {
    headers: { "X-Buyer-Id": buyerId },
  });
  const data = await res.json();
  return { res, data };
}

export async function getEventHelper(eventId: string) {
  const res = await app.request(`/events/${eventId}`);
  const data = await res.json();
  return { res, data };
}

export async function sendWebhookHelper(
  payload: any,
  secret = config.WEBHOOK_SECRET,
  signatureOverride?: string
) {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature =
    signatureOverride !== undefined
      ? signatureOverride
      : crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== "") {
    headers["X-Signature"] = signature;
  }

  const res = await app.request("/webhooks/payment", {
    method: "POST",
    headers,
    body: rawBody,
  });
  const data = await res.json();
  return { res, data };
}
