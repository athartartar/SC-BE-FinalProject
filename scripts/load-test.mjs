const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function run() {
  const eventRes = await fetch(`${BASE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Concurrency Load Test Event",
      startsAt: "2026-12-31T20:00:00.000Z",
      tickets: {
        reguler: { price: 50000, quota: 100 },
        vip: { price: 150000, quota: 20 },
      },
    }),
  });

  if (!eventRes.ok) {
    console.error("Failed to create event:", eventRes.status, await eventRes.text());
    process.exit(1);
  }

  const eventData = await eventRes.json();
  const reguler = eventData.ticketTypes.find((t) => t.name === "Reguler");
  if (!reguler) {
    console.error("Reguler ticket type not found in event response");
    process.exit(1);
  }

  const promises = Array.from({ length: 200 }, (_, i) =>
    fetch(`${BASE_URL}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buyer-Id": `load-buyer-${i + 1}`,
      },
      body: JSON.stringify({
        ticketTypeId: reguler.id,
        quantity: 1,
      }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    })
  );

  const results = await Promise.all(promises);

  let createdCount = 0;
  let soldOutCount = 0;
  let otherCount = 0;

  for (const r of results) {
    if (r.status === 201) {
      createdCount++;
    } else if (r.status === 409 && r.data?.error?.code === "SOLD_OUT") {
      soldOutCount++;
    } else {
      otherCount++;
    }
  }

  const checkRes = await fetch(`${BASE_URL}/events/${eventData.id}`);
  const checkData = await checkRes.json();
  const finalReguler = checkData.ticketTypes?.find((t) => t.name === "Reguler");
  const finalAvailable = finalReguler?.available ?? -1;

  console.log("=== Concurrency Load Test Result ===");
  console.log(`Target URL:       ${BASE_URL}`);
  console.log(`Event ID:         ${eventData.id}`);
  console.log(`Initial Quota:    100`);
  console.log(`Total Requests:   200`);
  console.log(`Created (201):    ${createdCount}`);
  console.log(`Sold Out (409):   ${soldOutCount}`);
  console.log(`Other Status:     ${otherCount}`);
  console.log(`Final Available:  ${finalAvailable}`);

  if (createdCount !== 100 || soldOutCount !== 100 || finalAvailable !== 0 || otherCount !== 0) {
    console.error("Load test assertions failed");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
