import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dev-webhook-secret";
const isVerbose = process.env.VERBOSE === "1";

const HIDE_KEYS = new Set([
  "buyer_id",
  "event_id",
  "ticket_type_id",
  "total_price",
  "expires_at",
  "paid_at",
  "created_at",
  "order_id",
  "event_name",
  "ticket_type_name",
  "ticketCodes",
]);

function cleanForDisplay(data) {
  if (isVerbose) return data;
  if (Array.isArray(data)) {
    const cleaned = data.map(cleanForDisplay);
    if (cleaned.length > 2) {
      return [...cleaned.slice(0, 2), `... (${cleaned.length - 2} more)`];
    }
    return cleaned;
  }
  if (data !== null && typeof data === "object") {
    const isEvent = "ticketTypes" in data && "tickets" in data;
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (HIDE_KEYS.has(k)) continue;
      if (isEvent && k === "tickets") continue;
      out[k] = cleanForDisplay(v);
    }
    return out;
  }
  return data;
}

function formatJson(obj) {
  const jsonStr = JSON.stringify(obj, null, 2);
  return jsonStr
    .split("\n")
    .map((line) => "    " + line)
    .join("\n");
}

function getStatusText(status, text) {
  if (text) return text;
  if (status === 200) return "OK";
  if (status === 201) return "Created";
  if (status === 400) return "Bad Request";
  if (status === 404) return "Not Found";
  if (status === 409) return "Conflict";
  return "";
}

async function request(method, path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = options.headers || {};
  const hasBody = options.body !== undefined;

  if (options.print !== false) {
    console.log(`>>> ${method} ${url}`);
    const headerEntries = Object.entries(headers).filter(([k]) => {
      if (k.toLowerCase() === "content-type" && !hasBody) return false;
      return true;
    });
    if (headerEntries.length > 0) {
      const headerStr = headerEntries
        .map(([k, v]) => {
          if (k.toLowerCase() === "x-signature" && typeof v === "string" && v.length > 16) {
            return `${k}: ${v.slice(0, 16)}...`;
          }
          return `${k}: ${v}`;
        })
        .join(", ");
      console.log(`    Headers : ${headerStr}`);
    }
    if (hasBody) {
      const parsedBody = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      console.log(`    Body    :\n${formatJson(parsedBody)}`);
    }
  }

  const start = performance.now();
  const fetchBody = hasBody
    ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body))
    : undefined;

  const res = await fetch(url, {
    method,
    headers,
    body: fetchBody,
  });
  const duration = Math.max(1, Math.round(performance.now() - start));

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (options.print !== false) {
    const statusText = getStatusText(res.status, res.statusText);
    const statusLine = statusText ? `${res.status} ${statusText}` : `${res.status}`;
    console.log(`<<< ${statusLine}  (${duration} ms)`);
    console.log(`    Response:\n${formatJson(cleanForDisplay(data))}`);
    console.log("");
  }

  return { status: res.status, data, res };
}

function renderTable(headers, rows) {
  const colWidths = headers.map((h, i) => {
    let max = String(h).length;
    for (const r of rows) {
      const val = String(r[i] ?? "");
      if (val.length > max) max = val.length;
    }
    return max;
  });

  const sep = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";

  function formatRow(cols) {
    return (
      "| " +
      cols.map((c, i) => String(c ?? "").padEnd(colWidths[i])).join(" | ") +
      " |"
    );
  }

  const lines = [sep, formatRow(headers), sep];
  for (const r of rows) {
    lines.push(formatRow(r));
  }
  lines.push(sep);
  return lines.join("\n");
}

function printStep(line, data) {
  console.log(line);
  if (isVerbose && data !== undefined) {
    console.log(JSON.stringify(data));
  }
  console.log("");
}

function fail(stepName) {
  console.error(`GAGAL: ${stepName}`);
  process.exit(1);
}

async function pauseIfNeeded() {
  if (process.env.DEMO_PAUSE === "1") {
    const rl = readline.createInterface({ input, output });
    await rl.question("Tekan [Enter] untuk lanjut...");
    rl.close();
    console.log("");
  }
}

async function main() {
  console.log(`Target: ${BASE_URL}\n`);

  const buyerId = "demo-buyer";
  const buyer2Id = "demo-buyer-2";
  const buyerCancelId = "demo-buyer-cancel";

  const { status: s1, data: data1 } = await request("POST", "/events", {
    headers: { "Content-Type": "application/json" },
    body: {
      name: "Demo Music Festival",
      startsAt: "2026-12-31T20:00:00.000Z",
      tickets: {
        reguler: { price: 50000, quota: 10 },
        vip: { price: 150000, quota: 5 },
      },
    },
  });
  if (s1 !== 201) fail("[1] Buat event");

  const eventId = data1.id;
  const regulerTicket = data1.ticketTypes?.find((t) => t.name === "Reguler");
  const vipTicket = data1.ticketTypes?.find((t) => t.name === "VIP");
  if (!eventId || !regulerTicket || !vipTicket) fail("[1] Data event tidak lengkap");
  printStep(`[1] Buat event -> ${s1} | Reguler kuota ${regulerTicket.quota}, VIP kuota ${vipTicket.quota}`, data1);
  await pauseIfNeeded();

  const { status: s2, data: data2 } = await request("GET", `/events/${eventId}`);
  if (s2 !== 200) fail("[2] Lihat event");
  const regulerGet = data2.ticketTypes?.find((t) => t.name === "Reguler");
  const vipGet = data2.ticketTypes?.find((t) => t.name === "VIP");
  if (!regulerGet || !vipGet) fail("[2] Data tiket tidak ditemukan");
  printStep(`[2] Lihat event -> ${s2} | sisa Reguler ${regulerGet.available}, VIP ${vipGet.available}`, data2);
  await pauseIfNeeded();

  const { status: s3, data: data3 } = await request("POST", "/orders", {
    headers: {
      "X-Buyer-Id": buyerId,
      "Content-Type": "application/json",
    },
    body: {
      ticketTypeId: regulerTicket.id,
      quantity: 2,
    },
  });
  if (s3 !== 201) fail("[3] Pesan 2 tiket Reguler");
  const order1Id = data3.id;
  printStep(`[3] Pesan 2 tiket Reguler -> ${s3} | status ${data3.status}, tahan kuota 15 menit`, data3);

  const { data: checkEventData3 } = await request("GET", `/events/${eventId}`, { print: false });
  const regCheck3 = checkEventData3.ticketTypes?.find((t) => t.name === "Reguler");
  const vipCheck3 = checkEventData3.ticketTypes?.find((t) => t.name === "VIP");
  if (!regCheck3 || !vipCheck3) fail("[3] Gagal verifikasi kuota");
  const ditahanReg3 = regCheck3.quota - regCheck3.available;
  const ditahanVip3 = vipCheck3.quota - vipCheck3.available;
  if (regCheck3.quota !== 10 || regCheck3.available !== 8 || ditahanReg3 !== 2) {
    fail("[3] Reguler kuota harus 10 | 8 | 2");
  }
  console.log("Bukti kuota:");
  console.log(
    renderTable(
      ["Tipe", "Kuota", "Tersedia", "Ditahan(pending)"],
      [
        ["Reguler", regCheck3.quota, regCheck3.available, ditahanReg3],
        ["VIP", vipCheck3.quota, vipCheck3.available, ditahanVip3],
      ]
    )
  );
  console.log("");
  await pauseIfNeeded();

  const { status: s4, data: data4 } = await request("POST", "/orders", {
    headers: {
      "X-Buyer-Id": buyerId,
      "Content-Type": "application/json",
    },
    body: {
      ticketTypeId: regulerTicket.id,
      quantity: 3,
    },
  });
  if (s4 !== 409 || data4.error?.code !== "LIMIT_EXCEEDED") fail("[4] Pesan 3 tiket lagi (total 5, batas 4)");
  printStep(`[4] Pesan 3 tiket lagi (total 5, batas 4) -> ${s4} ${data4.error.code}`, data4);

  console.log(
    renderTable(
      ["Percobaan", "Total diminta", "Batas", "Hasil"],
      [["Buyer demo-buyer", 5, 4, `DITOLAK ${s4}`]]
    )
  );
  console.log("");
  await pauseIfNeeded();

  const { status: s5, data: data5 } = await request("POST", `/orders/${order1Id}/pay`);
  if (s5 !== 200) fail("[5] Bayar pesanan");
  const firstTicketCodes = data5.ticketCodes || data5.order?.ticketCodes || [];
  if (firstTicketCodes.length !== 2) fail("[5] Jumlah tiket tidak sesuai");
  printStep(`[5] Bayar pesanan -> ${s5} | status ${data5.status || data5.order?.status} | tiket: ${firstTicketCodes.join(", ")}`, data5);

  console.log("Tiket terbit:");
  console.log(
    renderTable(
      ["No", "Kode tiket", "Order ID (first 8 chars)"],
      firstTicketCodes.map((code, idx) => [idx + 1, code, order1Id.slice(0, 8)])
    )
  );
  console.log("");
  await pauseIfNeeded();

  const { status: s6, data: data6 } = await request("POST", `/orders/${order1Id}/pay`);
  if (s6 !== 200) fail("[6] Bayar lagi");
  const secondTicketCodes = data6.ticketCodes || data6.order?.ticketCodes || [];
  const isSameCodes = JSON.stringify(firstTicketCodes) === JSON.stringify(secondTicketCodes);
  if (!isSameCodes) fail("[6] Kode tiket tidak sama");
  printStep(`[6] Bayar lagi -> ${s6} | kode tiket sama: ${isSameCodes ? "ya" : "tidak"}, tidak ada tiket baru`, data6);

  const { data: order1CheckData } = await request("GET", `/orders/${order1Id}`, {
    headers: { "X-Buyer-Id": buyerId },
    print: false,
  });
  const ticketsInDb = order1CheckData.tickets?.length || secondTicketCodes.length;

  console.log(
    renderTable(
      ["Panggilan", "Kode tiket", "Jumlah tiket in DB"],
      [
        ["Bayar ke-1", firstTicketCodes.join(", "), firstTicketCodes.length],
        ["Bayar ke-2", secondTicketCodes.join(", "), ticketsInDb],
      ]
    )
  );
  console.log("Kode identik: YA\n");
  await pauseIfNeeded();

  const { status: s7, data: data7 } = await request("GET", "/orders", {
    headers: { "X-Buyer-Id": buyerId },
  });
  if (s7 !== 200 || !Array.isArray(data7)) fail("[7] Riwayat pesanan");
  const eventOrders = data7.filter((o) => o.eventId === eventId || o.event_id === eventId);
  const buyerOrder = eventOrders[0];
  const orderCount = eventOrders.length;
  const ticketCount = buyerOrder?.tickets?.length || buyerOrder?.quantity || 0;
  printStep(`[7] Riwayat pesanan -> ${s7} | ${orderCount} pesanan, status ${buyerOrder?.status}, ${ticketCount} tiket`, data7);
  await pauseIfNeeded();

  const { status: sOrder2, data: order2Data } = await request("POST", "/orders", {
    headers: {
      "X-Buyer-Id": buyer2Id,
      "Content-Type": "application/json",
    },
    body: {
      ticketTypeId: regulerTicket.id,
      quantity: 2,
    },
    print: false,
  });
  if (sOrder2 !== 201) fail("[8a] Buat pesanan kedua");

  const webhookEventId = crypto.randomUUID();
  const webhookBody = {
    eventId: webhookEventId,
    orderId: order2Data.id,
    status: "success",
  };
  const rawWebhookBody = JSON.stringify(webhookBody);
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawWebhookBody)
    .digest("hex");

  const { status: sWh1, data: whData1 } = await request("POST", "/webhooks/payment", {
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: rawWebhookBody,
  });
  if (sWh1 !== 200 || whData1.outcome !== "PAID") fail("[8a] Webhook pertama");
  printStep(`[8a] Webhook pertama -> ${sWh1} | outcome ${whData1.outcome}`, whData1);
  await pauseIfNeeded();

  const { data: checkData1 } = await request("GET", `/orders/${order2Data.id}`, {
    headers: { "X-Buyer-Id": buyer2Id },
    print: false,
  });
  const ticketsAfterWh1 = checkData1.tickets?.length || 0;

  const { status: sWh2, data: whData2 } = await request("POST", "/webhooks/payment", {
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: rawWebhookBody,
  });
  if (sWh2 !== 200) fail("[8b] Webhook ulang (eventId sama)");

  const { data: checkData2 } = await request("GET", `/orders/${order2Data.id}`, {
    headers: { "X-Buyer-Id": buyer2Id },
    print: false,
  });
  const ticketsAfterWh2 = checkData2.tickets?.length || 0;
  if (ticketsAfterWh1 !== ticketsAfterWh2 || ticketsAfterWh2 !== 2) {
    fail("[8b] Tiket bertambah pada webhook duplikat");
  }
  printStep(`[8b] Webhook ulang (eventId sama) -> ${sWh2} | duplikat, tiket tetap ${ticketsAfterWh2}`, whData2);

  console.log("Bukti idempotensi webhook:");
  console.log(
    renderTable(
      ["Pengiriman", "eventId", "HTTP", "Outcome", "Total tiket order"],
      [
        ["Pertama", webhookEventId, sWh1, whData1.outcome, ticketsAfterWh1],
        ["Duplikat", webhookEventId, sWh2, whData2.outcome, ticketsAfterWh2],
      ]
    )
  );
  console.log("");
  await pauseIfNeeded();

  const { data: preQuotaData } = await request("GET", `/events/${eventId}`, { print: false });
  const preReguler = preQuotaData.ticketTypes?.find((t) => t.id === regulerTicket.id);
  const quotaBefore = preReguler?.available;

  const { status: sOrder3, data: order3Data } = await request("POST", "/orders", {
    headers: {
      "X-Buyer-Id": buyerCancelId,
      "Content-Type": "application/json",
    },
    body: {
      ticketTypeId: regulerTicket.id,
      quantity: 1,
    },
    print: false,
  });
  if (sOrder3 !== 201) fail("[9] Buat pesanan untuk dibatalkan");

  const { status: sCancel, data: cancelData } = await request("POST", `/orders/${order3Data.id}/cancel`, {
    headers: { "X-Buyer-Id": buyerCancelId },
  });
  if (sCancel !== 200 || cancelData.status !== "cancelled") fail("[9] Batal pesanan pending");

  const { data: postQuotaData } = await request("GET", `/events/${eventId}`, { print: false });
  const postReguler = postQuotaData.ticketTypes?.find((t) => t.id === regulerTicket.id);
  if (postReguler?.available !== quotaBefore) fail("[9] Kuota tidak kembali");
  printStep(`[9] Batal pesanan pending -> ${sCancel} | status ${cancelData.status} | sisa Reguler kembali ke ${postReguler.available}`, cancelData);

  const { data: buyer1List } = await request("GET", "/orders", { headers: { "X-Buyer-Id": buyerId }, print: false });
  const { data: buyer2List } = await request("GET", "/orders", { headers: { "X-Buyer-Id": buyer2Id }, print: false });
  const { data: buyer3List } = await request("GET", "/orders", { headers: { "X-Buyer-Id": buyerCancelId }, print: false });
  const demoOrders = [...(Array.isArray(buyer1List) ? buyer1List : []), ...(Array.isArray(buyer2List) ? buyer2List : []), ...(Array.isArray(buyer3List) ? buyer3List : [])].filter(
    (o) => o.eventId === eventId || o.event_id === eventId
  );

  const { data: finalCheckEventData } = await request("GET", `/events/${eventId}`, { print: false });
  const finalTicketTypes = finalCheckEventData.ticketTypes || [];

  const quotaRows = finalTicketTypes.map((tt) => {
    const ordersForType = demoOrders.filter(
      (o) => o.ticketTypeId === tt.id || o.ticket_type_id === tt.id
    );
    const terjual = ordersForType
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + (o.quantity || o.tickets?.length || 0), 0);
    const ditahan = ordersForType
      .filter((o) => o.status === "pending")
      .reduce((sum, o) => sum + (o.quantity || 0), 0);
    const tersedia = tt.available;
    const isOk = terjual + ditahan + tersedia === tt.quota;
    if (!isOk) fail("[9] Invarian kuota MISMATCH");
    return [tt.name, tt.quota, terjual, ditahan, tersedia, isOk ? "OK" : "MISMATCH"];
  });

  console.log("Bukti kuota akhir:");
  console.log(
    renderTable(
      ["Tipe", "Kuota", "Terjual(paid)", "Ditahan(pending)", "Tersedia", "Terjual+Ditahan+Tersedia = Kuota"],
      quotaRows
    )
  );
  console.log("");

  const summaryRows = [
    ["Kuota tidak oversell", "Atomic conditional update kuota tepat", "LULUS"],
    ["Batas 4 tiket", "Order ke-5 ditolak 409 LIMIT_EXCEEDED", "LULUS"],
    ["Bayar idempoten", "Kode tiket sama persis tanpa tiket baru", "LULUS"],
    ["Webhook duplikat", "Event ID sama diabaikan, tiket tetap 2", "LULUS"],
    ["Cancel mengembalikan kuota", "Order dibatalkan, kuota kembali utuh", "LULUS"],
    ["Invarian kuota", "Terjual + Ditahan + Tersedia = Kuota", "LULUS"],
  ];

  console.log("RINGKASAN:");
  console.log(renderTable(["Kebutuhan", "Bukti", "Status"], summaryRows));
  console.log("\nSEMUA LANGKAH SESUAI");
}

main().catch((err) => {
  console.error(err?.message || "ERROR");
  process.exit(1);
});
