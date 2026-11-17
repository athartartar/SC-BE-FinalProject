import crypto from "node:crypto";
import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { ticketTypes, tickets } from "../db/schema.js";
import { config } from "../config.js";
import { AppError } from "./errors.js";
import { expireDueOrders } from "./expiry.js";

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

    const o = orderRows[0];
    return {
      id: o.id,
      buyerId: o.buyer_id,
      buyer_id: o.buyer_id,
      eventId: o.event_id,
      event_id: o.event_id,
      ticketTypeId: o.ticket_type_id,
      ticket_type_id: o.ticket_type_id,
      quantity: o.quantity,
      totalPrice: o.total_price,
      total_price: o.total_price,
      status: o.status,
      expiresAt: o.expires_at,
      expires_at: o.expires_at,
      paidAt: o.paid_at,
      paid_at: o.paid_at,
      createdAt: o.created_at,
      created_at: o.created_at,
    };
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

    const o = updatedRows[0];
    return {
      id: o.id,
      buyerId: o.buyer_id,
      buyer_id: o.buyer_id,
      eventId: o.event_id,
      event_id: o.event_id,
      ticketTypeId: o.ticket_type_id,
      ticket_type_id: o.ticket_type_id,
      quantity: o.quantity,
      totalPrice: o.total_price,
      total_price: o.total_price,
      status: o.status,
      expiresAt: o.expires_at,
      expires_at: o.expires_at,
      paidAt: o.paid_at,
      paid_at: o.paid_at,
      createdAt: o.created_at,
      created_at: o.created_at,
    };
  });
}

export async function payOrder(orderId: string, client = db) {
  return await client.transaction(async (tx) => {
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

    if (updatedRows.length > 0) {
      const order = updatedRows[0];
      const insertedTickets = [];

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
        insertedTickets.push(ticketRows[0]);
      }

      return {
        id: order.id,
        buyerId: order.buyer_id,
        buyer_id: order.buyer_id,
        eventId: order.event_id,
        event_id: order.event_id,
        ticketTypeId: order.ticket_type_id,
        ticket_type_id: order.ticket_type_id,
        quantity: order.quantity,
        totalPrice: order.total_price,
        total_price: order.total_price,
        status: order.status,
        expiresAt: order.expires_at,
        expires_at: order.expires_at,
        paidAt: order.paid_at,
        paid_at: order.paid_at,
        createdAt: order.created_at,
        created_at: order.created_at,
        tickets: insertedTickets,
        ticketCodes: insertedTickets.map((t) => t.code),
      };
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
      throw new AppError(404, "NOT_FOUND", "Order not found");
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

      return {
        id: order.id,
        buyerId: order.buyer_id,
        buyer_id: order.buyer_id,
        eventId: order.event_id,
        event_id: order.event_id,
        ticketTypeId: order.ticket_type_id,
        ticket_type_id: order.ticket_type_id,
        quantity: order.quantity,
        totalPrice: order.total_price,
        total_price: order.total_price,
        status: order.status,
        expiresAt: order.expires_at,
        expires_at: order.expires_at,
        paidAt: order.paid_at,
        paid_at: order.paid_at,
        createdAt: order.created_at,
        created_at: order.created_at,
        tickets: existingTickets,
        ticketCodes: existingTickets.map((t) => t.code),
      };
    }

    if (order.status === "cancelled") {
      throw new AppError(409, "ORDER_CANCELLED", "Order has been cancelled");
    }

    if (order.status === "expired") {
      throw new AppError(409, "ORDER_EXPIRED", "Order has expired");
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

      throw new AppError(409, "ORDER_EXPIRED", "Order has expired");
    }

    throw new AppError(409, "CONFLICT", "Order cannot be paid");
  });
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
    const oTickets = ticketList.filter((t) => t.orderId === o.id);
    return {
      id: o.id,
      buyerId: o.buyer_id,
      buyer_id: o.buyer_id,
      eventId: o.event_id,
      event_id: o.event_id,
      eventName: o.event_name,
      event_name: o.event_name,
      ticketTypeId: o.ticket_type_id,
      ticket_type_id: o.ticket_type_id,
      ticketTypeName: o.ticket_type_name,
      ticket_type_name: o.ticket_type_name,
      quantity: o.quantity,
      totalPrice: o.total_price,
      total_price: o.total_price,
      status: o.status,
      expiresAt: o.expires_at,
      expires_at: o.expires_at,
      paidAt: o.paid_at,
      paid_at: o.paid_at,
      createdAt: o.created_at,
      created_at: o.created_at,
      tickets: oTickets,
      ticketCodes: oTickets.map((t) => t.code),
    };
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

  return {
    id: o.id,
    buyerId: o.buyer_id,
    buyer_id: o.buyer_id,
    eventId: o.event_id,
    event_id: o.event_id,
    eventName: o.event_name,
    event_name: o.event_name,
    ticketTypeId: o.ticket_type_id,
    ticket_type_id: o.ticket_type_id,
    ticketTypeName: o.ticket_type_name,
    ticket_type_name: o.ticket_type_name,
    quantity: o.quantity,
    totalPrice: o.total_price,
    total_price: o.total_price,
    status: o.status,
    expiresAt: o.expires_at,
    expires_at: o.expires_at,
    paidAt: o.paid_at,
    paid_at: o.paid_at,
    createdAt: o.created_at,
    created_at: o.created_at,
    tickets: oTickets,
    ticketCodes: oTickets.map((t) => t.code),
  };
}
