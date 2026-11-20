import crypto from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dev-webhook-secret";

const [orderId, status, eventIdArg] = process.argv.slice(2);

if (!orderId || !status) {
  console.error("Usage: node scripts/send-webhook.mjs <orderId> <success|failed> [eventId]");
  process.exit(1);
}

const eventId = eventIdArg || crypto.randomUUID();
const payload = JSON.stringify({ eventId, orderId, status });
const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

const res = await fetch(`${BASE_URL}/webhooks/payment`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Signature": signature,
  },
  body: payload,
});

const body = await res.text();
console.log(`Status: ${res.status}`);
console.log(body);

if (!res.ok) {
  process.exit(1);
}
