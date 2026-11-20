import crypto from "node:crypto";
import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { ticketTypes, tickets } from "../db/schema.js";
import { config } from "../config.js";
import { AppError } from "./errors.js";
import { expireDueOrders } from "./expiry.js";

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

export interface FormattedTicket {
  id: string;
  orderId: string;
  code: string;
  seq: number;
  createdAt: string;
}

export function formatTicket(t: {
  id: string;
  orderId?: string;
  order_id?: string;
  code: string;
  seq: number;
  createdAt?: Date | string | null;
  created_at?: Date | string | null;
}): FormattedTicket {
  return {
    id: t.id,
    orderId: t.orderId ?? t.order_id!,
    code: t.code,
    seq: t.seq,
    createdAt: toIso(t.createdAt ?? t.created_at)!,
  };
}

export interface FormattedOrder {
  id: string;
  buyerId: string;
  eventId: string;
  eventName?: string;
  ticketTypeId: string;
  ticketTypeName?: string;
  quantity: number;
  totalPrice: number;
  status: string;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  tickets?: FormattedTicket[];
  ticketCodes?: string[];
}

export function formatOrder(
  o: {
    id: string;
    buyerId?: string;
    buyer_id?: string;
    eventId?: string;
    event_id?: string;
    ticketTypeId?: string;
    ticket_type_id?: string;
    quantity: number;
    totalPrice?: number;
    total_price?: number;
    status: string;
    expiresAt?: Date | string | null;
    expires_at?: Date | string | null;
    paidAt?: Date | string | null;
    paid_at?: Date | string | null;
    createdAt?: Date | string | null;
    created_at?: Date | string | null;
  },
  extras?: {
    eventName?: string;
    ticketTypeName?: string;
    tickets?: FormattedTicket[];
  }
): FormattedOrder {
  const result: FormattedOrder = {
    id: o.id,
    buyerId: o.buyerId ?? o.buyer_id!,
    eventId: o.eventId ?? o.event_id!,
    ticketTypeId: o.ticketTypeId ?? o.ticket_type_id!,
    quantity: o.quantity,
    totalPrice: o.totalPrice ?? o.total_price!,
    status: o.status,
    expiresAt: toIso(o.expiresAt ?? o.expires_at)!,
    paidAt: toIso(o.paidAt ?? o.paid_at),
    createdAt: toIso(o.createdAt ?? o.created_at)!,
  };

  if (extras?.eventName !== undefined) {
    result.eventName = extras.eventName;
  }
  if (extras?.ticketTypeName !== undefined) {
    result.ticketTypeName = extras.ticketTypeName;
  }
  if (extras?.tickets !== undefined) {
    result.tickets = extras.tickets;
    result.ticketCodes = extras.tickets.map((t) => t.code);
  }

  return result;
}

export async function createOrder(
  buyerId: string,
  ticketTypeId: string,
  quantity: number,
  client = db
) {
  await expireDueOrders(client);

  return await client.transaction(async (tx) => {
    const [ticketType] = await tx
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, ticketTypeId));

    if (!ticketType) {
      throw new AppError(404, "NOT_FOUND", "Ticket type not found");
    }

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${buyerId} || ':' || ${ticketType.eventId}))`
    );

    const sumResult = await tx.execute<{ total: number }>(sql`
      SELECT COALESCE(SUM(quantity), 0)::int AS total
      FROM orders
      WHERE buyer_id = ${buyerId}
        AND event_id = ${ticketType.eventId}
        AND (status = 'paid' OR (status = 'pending' AND expires_at > now()))
    `);

    const currentTotal = Number(sumResult[0]?.total ?? 0);
    if (currentTotal + quantity > 4) {
      throw new AppError(
        409,
        "LIMIT_EXCEEDED",
        "Order quantity limit exceeded for this event"
      );
    }

    const decResult = await tx.execute<{
      id: string;
      event_id: string;
      price: number;
    }>(sql`
      UPDATE ticket_types
      SET available = available - ${quantity}
      WHERE id = ${ticketTypeId} AND available >= ${quantity}
      RETURNING id, event_id, price
    `);

    if (decResult.length === 0) {
      throw new AppError(
        409,
        "SOLD_OUT",
        "Ticket type is sold out or insufficient quota"
      );
    }

    const orderRows = await tx.execute<{
      id: string;
      buyer_id: string;
      event_id: string;
      ticket_type_id: string;
      quantity: number;
      total_price: number;
      status: string;
      expires_at: Date;
      paid_at: Date | null;
      created_at: Date;
    }>(sql`
      INSERT INTO orders (buyer_id, event_id, ticket_type_id, quantity, total_price, status, expires_at)
      VALUES (
        ${buyerId},
        ${ticketType.eventId},
        ${ticketTypeId},
        ${quantity},
        ${ticketType.price * quantity},
        'pending',
        now() + (${config.ORDER_TTL_MINUTES} * interval '1 minute')
      )
      RETURNING *
    `);

    return formatOrder(orderRows[0]);
  });
}

export async function cancelOrder(
  buyerId: string,
  orderId: string,
  client = db
) {
  return await client.transaction(async (tx) => {
    const orderRows = await tx.execute<{
      id: string;
      buyer_id: string;
      ticket_type_id: string;
      quantity: number;
      status: string;
    }>(sql`
      SELECT id, buyer_id, ticket_type_id, quantity, status
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `);

    if (orderRows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Order not found");
    }

    const order = orderRows[0];
    if (order.buyer_id !== buyerId) {
      throw new AppError(403, "FORBIDDEN", "Wrong owner");
    }

    if (order.status !== "pending") {
      throw new AppError(409, "ORDER_NOT_PENDING", "Order is not pending");
    }

    const updatedRows = await tx.execute<{
      id: string;
      buyer_id: string;
      event_id: string;
      ticket_type_id: string;
      quantity: number;
      total_price: number;
      status: string;
      expires_at: Date;
      paid_at: Date | null;
      created_at: Date;
    }>(sql`
      UPDATE orders
      SET status = 'cancelled'
      WHERE id = ${orderId} AND status = 'pending'
      RETURNING *
    `);

    await tx.execute(sql`
      UPDATE ticket_types
      SET available = available + ${order.quantity}
      WHERE id = ${order.ticket_type_id}
    `);

    return formatOrder(updatedRows[0]);
  });
}

type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function executeOrderPayment(tx: DBTransaction, orderId: string) {
  const updatedRows = await tx.execute<{
    id: string;
    buyer_id: string;
    event_id: string;
    ticket_type_id: string;
    quantity: number;
    total_price: number;
    status: string;
    expires_at: Date;
    paid_at: Date;
    created_at: Date;
  }>(sql`
    UPDATE orders
    SET status = 'paid', paid_at = now()
    WHERE id = ${orderId} AND status = 'pending' AND expires_at > now()
    RETURNING *
  `);

  if (updatedRows.length === 0) {
    return null;
  }

  const order = updatedRows[0];
  const insertedTickets: FormattedTicket[] = [];

  for (let seq = 1; seq <= order.quantity; seq++) {
    const code = `TKT-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const ticketRows = await tx.execute<{
      id: string;
      order_id: string;
      code: string;
      seq: number;
      created_at: Date;
    }>(sql`
      INSERT INTO tickets (order_id, code, seq)
      VALUES (${order.id}, ${code}, ${seq})
      RETURNING *
    `);
    insertedTickets.push(formatTicket(ticketRows[0]));
  }

  return {
    order: formatOrder(order, { tickets: insertedTickets }),
  };
}

export async function processPaymentWebhook(
  payload: { eventId: string; orderId: string; status: "success" | "failed" },
  client = db
) {
  return await client.transaction(async (tx) => {
    const existingEvents = await tx.execute<{ outcome: string }>(sql`
      SELECT outcome
      FROM webhook_events
      WHERE provider_event_id = ${payload.eventId}
    `);

    if (existingEvents.length > 0) {
      return { outcome: existingEvents[0].outcome };
    }

    const orderRows = await tx.execute<{
      id: string;
      status: string;
      expires_at: Date;
    }>(sql`
      SELECT id, status, expires_at
      FROM orders
      WHERE id = ${payload.orderId}
      FOR UPDATE
    `);

    if (orderRows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Order not found");
    }

    const order = orderRows[0];
    let outcome: string;

    if (payload.status === "failed") {
      outcome = "RECORDED";
    } else if (order.status === "paid") {
      outcome = "ALREADY_PAID";
    } else if (order.status === "cancelled" || order.status === "expired") {
      outcome = "LATE_NOT_ISSUED";
    } else {
      const paid = await executeOrderPayment(tx, order.id);
      if (paid) {
        outcome = "PAID";
      } else {
        outcome = "LATE_NOT_ISSUED";
      }
    }

    const inserted = await tx.execute<{ outcome: string }>(sql`
      INSERT INTO webhook_events (provider_event_id, order_id, payload, outcome)
      VALUES (
        ${payload.eventId},
        ${payload.orderId},
        ${JSON.stringify(payload)}::jsonb,
        ${outcome}
      )
      ON CONFLICT (provider_event_id) DO NOTHING
      RETURNING outcome
    `);

    if (inserted.length === 0) {
      const [recheck] = await tx.execute<{ outcome: string }>(sql`
        SELECT outcome
        FROM webhook_events
        WHERE provider_event_id = ${payload.eventId}
      `);
      return { outcome: recheck?.outcome ?? outcome };
    }

    return { outcome };
  });
}

export async function payOrder(orderId: string, client = db) {
  const result = await client.transaction(async (tx) => {
    const paidResult = await executeOrderPayment(tx, orderId);
    if (paidResult) {
      return paidResult;
    }

    const orderRows = await tx.execute<{
      id: string;
      buyer_id: string;
      event_id: string;
      ticket_type_id: string;
      quantity: number;
      total_price: number;
      status: string;
      expires_at: Date;
      paid_at: Date | null;
      created_at: Date;
    }>(sql`
      SELECT *
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `);

    if (orderRows.length === 0) {
      return { notFound: true };
    }

    const order = orderRows[0];

    if (order.status === "paid") {
      const existingTickets = await tx.execute<{
        id: string;
        order_id: string;
        code: string;
        seq: number;
        created_at: Date;
      }>(sql`
        SELECT *
        FROM tickets
        WHERE order_id = ${orderId}
        ORDER BY seq ASC
      `);

      const formattedTickets = existingTickets.map(formatTicket);

      return {
        order: formatOrder(order, { tickets: formattedTickets }),
      };
    }

    if (order.status === "cancelled") {
      return { isCancelled: true };
    }

    if (order.status === "expired") {
      return { isExpired: true };
    }

    if (order.status === "pending") {
      await tx.execute(sql`
        UPDATE orders
        SET status = 'expired'
        WHERE id = ${orderId} AND status = 'pending'
      `);

      await tx.execute(sql`
        UPDATE ticket_types
        SET available = available + ${order.quantity}
        WHERE id = ${order.ticket_type_id}
      `);

      return { isExpired: true };
    }

    return { conflict: true };
  });

  if ("notFound" in result && result.notFound) {
    throw new AppError(404, "NOT_FOUND", "Order not found");
  }
  if ("isCancelled" in result && result.isCancelled) {
    throw new AppError(409, "ORDER_CANCELLED", "Order has been cancelled");
  }
  if ("isExpired" in result && result.isExpired) {
    throw new AppError(409, "ORDER_EXPIRED", "Order has expired");
  }
  if ("conflict" in result && result.conflict) {
    throw new AppError(409, "CONFLICT", "Order cannot be paid");
  }

  return (result as { order: FormattedOrder }).order;
}

export async function getOrdersByBuyer(buyerId: string, client = db) {
  const orderRows = await client.execute<{
    id: string;
    buyer_id: string;
    event_id: string;
    ticket_type_id: string;
    quantity: number;
    total_price: number;
    status: string;
    expires_at: Date;
    paid_at: Date | null;
    created_at: Date;
    event_name: string;
    ticket_type_name: string;
  }>(sql`
    SELECT
      o.id,
      o.buyer_id,
      o.event_id,
      o.ticket_type_id,
      o.quantity,
      o.total_price,
      o.status,
      o.expires_at,
      o.paid_at,
      o.created_at,
      e.name AS event_name,
      tt.name AS ticket_type_name
    FROM orders o
    JOIN events e ON o.event_id = e.id
    JOIN ticket_types tt ON o.ticket_type_id = tt.id
    WHERE o.buyer_id = ${buyerId}
    ORDER BY o.created_at DESC
  `);

  if (orderRows.length === 0) {
    return [];
  }

  const orderIds = orderRows.map((o) => o.id);
  const ticketList = await client
    .select()
    .from(tickets)
    .where(inArray(tickets.orderId, orderIds))
    .orderBy(asc(tickets.seq));

  return orderRows.map((o) => {
    const oTickets = ticketList
      .filter((t) => t.orderId === o.id)
      .map(formatTicket);

    return formatOrder(o, {
      eventName: o.event_name,
      ticketTypeName: o.ticket_type_name,
      tickets: oTickets,
    });
  });
}

export async function getOrderById(
  buyerId: string,
  orderId: string,
  client = db
) {
  const orderRows = await client.execute<{
    id: string;
    buyer_id: string;
    event_id: string;
    ticket_type_id: string;
    quantity: number;
    total_price: number;
    status: string;
    expires_at: Date;
    paid_at: Date | null;
    created_at: Date;
    event_name: string;
    ticket_type_name: string;
  }>(sql`
    SELECT
      o.id,
      o.buyer_id,
      o.event_id,
      o.ticket_type_id,
      o.quantity,
      o.total_price,
      o.status,
      o.expires_at,
      o.paid_at,
      o.created_at,
      e.name AS event_name,
      tt.name AS ticket_type_name
    FROM orders o
    JOIN events e ON o.event_id = e.id
    JOIN ticket_types tt ON o.ticket_type_id = tt.id
    WHERE o.id = ${orderId}
  `);

  if (orderRows.length === 0) {
    throw new AppError(404, "NOT_FOUND", "Order not found");
  }

  const o = orderRows[0];
  if (o.buyer_id !== buyerId) {
    throw new AppError(403, "FORBIDDEN", "Wrong owner");
  }

  const oTickets = await client
    .select()
    .from(tickets)
    .where(eq(tickets.orderId, orderId))
    .orderBy(asc(tickets.seq));

  const formattedTickets = oTickets.map(formatTicket);

  return formatOrder(o, {
    eventName: o.event_name,
    ticketTypeName: o.ticket_type_name,
    tickets: formattedTickets,
  });
}
