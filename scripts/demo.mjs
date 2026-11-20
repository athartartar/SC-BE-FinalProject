import crypto from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dev-webhook-secret";

async function main() {
  const res1 = await fetch(`${BASE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Demo Music Festival",
      startsAt: "2026-12-31T20:00:00.000Z",
      tickets: {
        reguler: { price: 50000, quota: 10 },
        vip: { price: 150000, quota: 5 },
      },
    }),
  });
  const data1 = await res1.json().catch(() => ({}));
  console.log(`[1] Create event -> ${res1.status}`);
  console.log(JSON.stringify(data1));
  if (res1.status !== 201) process.exit(1);

  const eventId = data1.id;
  const regulerTicket = data1.ticketTypes?.find((t) => t.name === "Reguler");
  if (!eventId || !regulerTicket) process.exit(1);

  const res2 = await fetch(`${BASE_URL}/events/${eventId}`);
  const data2 = await res2.json().catch(() => ({}));
  console.log(`[2] GET event -> ${res2.status}`);
  console.log(JSON.stringify(data2));
  if (res2.status !== 200) process.exit(1);

  const res3 = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Buyer-Id": "demo-buyer",
    },
    body: JSON.stringify({
      ticketTypeId: regulerTicket.id,
      quantity: 2,
    }),
  });
  const data3 = await res3.json().catch(() => ({}));
  console.log(`[3] buyer "demo-buyer" orders 2 Reguler -> ${res3.status}`);
  console.log(JSON.stringify(data3));
  if (res3.status !== 201) process.exit(1);
  const order1Id = data3.id;

  const res4 = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Buyer-Id": "demo-buyer",
    },
    body: JSON.stringify({
      ticketTypeId: regulerTicket.id,
      quantity: 3,
    }),
  });
  const data4 = await res4.json().catch(() => ({}));
  console.log(`[4] same buyer orders 3 more (expect 409 LIMIT_EXCEEDED) -> ${res4.status}`);
  console.log(JSON.stringify(data4));
  if (res4.status !== 409 || data4.error?.code !== "LIMIT_EXCEEDED") process.exit(1);

  const res5 = await fetch(`${BASE_URL}/orders/${order1Id}/pay`, {
    method: "POST",
  });
  const data5 = await res5.json().catch(() => ({}));
  console.log(`[5] Pay the order -> ${res5.status}`);
  console.log(JSON.stringify(data5));
  if (res5.status !== 200) process.exit(1);

  const firstTicketCodes = data5.ticketCodes || data5.order?.ticketCodes || [];
  if (firstTicketCodes.length !== 2) process.exit(1);

  const res6 = await fetch(`${BASE_URL}/orders/${order1Id}/pay`, {
    method: "POST",
  });
  const data6 = await res6.json().catch(() => ({}));
  console.log(`[6] Pay again (same ticket codes) -> ${res6.status}`);
  console.log(JSON.stringify(data6));
  if (res6.status !== 200) process.exit(1);

  const secondTicketCodes = data6.ticketCodes || data6.order?.ticketCodes || [];
  if (JSON.stringify(firstTicketCodes) !== JSON.stringify(secondTicketCodes)) {
    process.exit(1);
  }

  const res7 = await fetch(`${BASE_URL}/orders`, {
    headers: { "X-Buyer-Id": "demo-buyer" },
  });
  const data7 = await res7.json().catch(() => ({}));
  console.log(`[7] GET /orders for the buyer -> ${res7.status}`);
  console.log(JSON.stringify(data7));
  if (res7.status !== 200) process.exit(1);

  const order2Res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Buyer-Id": "demo-buyer-2",
    },
    body: JSON.stringify({
      ticketTypeId: regulerTicket.id,
      quantity: 1,
    }),
  });
  if (order2Res.status !== 201) process.exit(1);
  const order2Data = await order2Res.json();

  const webhookEventId = crypto.randomUUID();
  const webhookBody = JSON.stringify({
    eventId: webhookEventId,
    orderId: order2Data.id,
    status: "success",
  });
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(webhookBody)
    .digest("hex");

  const whRes1 = await fetch(`${BASE_URL}/webhooks/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: webhookBody,
  });
  if (whRes1.status !== 200) process.exit(1);

  const whRes2 = await fetch(`${BASE_URL}/webhooks/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: webhookBody,
  });
  const whData2 = await whRes2.json().catch(() => ({}));
  console.log(`[8] Send signed success webhook for second order twice -> ${whRes2.status}`);
  console.log(JSON.stringify(whData2));
  if (whRes2.status !== 200) process.exit(1);

  const checkOrderRes = await fetch(`${BASE_URL}/orders/${order2Data.id}`, {
    headers: { "X-Buyer-Id": "demo-buyer-2" },
  });
  const checkOrderData = await checkOrderRes.json().catch(() => ({}));
  if (checkOrderData.tickets?.length !== 1) process.exit(1);

  const preQuotaRes = await fetch(`${BASE_URL}/events/${eventId}`);
  const preQuotaData = await preQuotaRes.json().catch(() => ({}));
  const preReguler = preQuotaData.ticketTypes?.find((t) => t.id === regulerTicket.id);
  const quotaBefore = preReguler?.available;

  const order3Res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Buyer-Id": "demo-buyer-cancel",
    },
    body: JSON.stringify({
      ticketTypeId: regulerTicket.id,
      quantity: 1,
    }),
  });
  if (order3Res.status !== 201) process.exit(1);
  const order3Data = await order3Res.json();

  const cancelRes = await fetch(`${BASE_URL}/orders/${order3Data.id}/cancel`, {
    method: "POST",
    headers: { "X-Buyer-Id": "demo-buyer-cancel" },
  });
  const cancelData = await cancelRes.json().catch(() => ({}));
  console.log(`[9] Another buyer cancels pending order and restores quota -> ${cancelRes.status}`);
  console.log(JSON.stringify(cancelData));
  if (cancelRes.status !== 200) process.exit(1);

  const postQuotaRes = await fetch(`${BASE_URL}/events/${eventId}`);
  const postQuotaData = await postQuotaRes.json().catch(() => ({}));
  const postReguler = postQuotaData.ticketTypes?.find((t) => t.id === regulerTicket.id);
  if (postReguler?.available !== quotaBefore) process.exit(1);
}

main().catch(() => {
  process.exit(1);
});
