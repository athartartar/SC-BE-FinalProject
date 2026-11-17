import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export async function expireDueOrders(client = db) {
  await client.transaction(async (tx) => {
    const expiredOrders = await tx.execute<{
      ticket_type_id: string;
      quantity: number;
    }>(sql`
      UPDATE orders
      SET status = 'expired'
      WHERE id IN (
        SELECT id FROM orders
        WHERE status = 'pending' AND expires_at <= now()
        FOR UPDATE SKIP LOCKED
      )
      RETURNING ticket_type_id, quantity
    `);

    if (expiredOrders.length === 0) {
      return;
    }

    const restockMap = new Map<string, number>();
    for (const order of expiredOrders) {
      const current = restockMap.get(order.ticket_type_id) ?? 0;
      restockMap.set(order.ticket_type_id, current + Number(order.quantity));
    }

    for (const [ticketTypeId, qty] of restockMap.entries()) {
      await tx.execute(sql`
        UPDATE ticket_types
        SET available = available + ${qty}
        WHERE id = ${ticketTypeId}
      `);
    }
  });
}
