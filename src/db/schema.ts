import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  pgEnum,
  unique,
  check,
  index,
} from "drizzle-orm/pg-core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "cancelled",
  "expired",
]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  }
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    quota: integer("quota").notNull(),
    available: integer("available").notNull(),
  },
  (table) => [
    unique("ticket_types_event_id_name_unique").on(table.eventId, table.name),
    check("ticket_types_available_check", sql`${table.available} >= 0 and ${table.available} <= ${table.quota}`),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerId: text("buyer_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    quantity: integer("quantity").notNull(),
    totalPrice: integer("total_price").notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    check("orders_quantity_check", sql`${table.quantity} >= 1 and ${table.quantity} <= 4`),
    index("orders_status_expires_at_idx").on(table.status, table.expiresAt),
    index("orders_buyer_id_event_id_idx").on(table.buyerId, table.eventId),
  ]
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    code: text("code").notNull().unique(),
    seq: integer("seq").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("tickets_order_id_seq_unique").on(table.orderId, table.seq),
  ]
);
