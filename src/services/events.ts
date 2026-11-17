import { eq, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { events, ticketTypes } from "../db/schema.js";
import { expireDueOrders } from "./expiry.js";

export interface CreateEventInput {
  name: string;
  startsAt: Date;
  tickets: {
    reguler: { price: number; quota: number };
    vip: { price: number; quota: number };
  };
}

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

export async function createEvent(data: CreateEventInput, client = db) {
  return await client.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        name: data.name,
        startsAt: data.startsAt,
      })
      .returning();

    const createdTicketTypes = await tx
      .insert(ticketTypes)
      .values([
        {
          eventId: event.id,
          name: "Reguler",
          price: data.tickets.reguler.price,
          quota: data.tickets.reguler.quota,
          available: data.tickets.reguler.quota,
        },
        {
          eventId: event.id,
          name: "VIP",
          price: data.tickets.vip.price,
          quota: data.tickets.vip.quota,
          available: data.tickets.vip.quota,
        },
      ])
      .returning();

    return {
      id: event.id,
      name: event.name,
      startsAt: toIso(event.startsAt)!,
      createdAt: toIso(event.createdAt)!,
      ticketTypes: createdTicketTypes,
      tickets: createdTicketTypes,
    };
  });
}

export async function getEvents(client = db) {
  await expireDueOrders(client);

  const allEvents = await client
    .select()
    .from(events)
    .orderBy(asc(events.startsAt));

  if (allEvents.length === 0) {
    return [];
  }

  const allTypes = await client.select().from(ticketTypes);

  return allEvents.map((event) => {
    const types = allTypes.filter((t) => t.eventId === event.id);
    return {
      id: event.id,
      name: event.name,
      startsAt: toIso(event.startsAt)!,
      createdAt: toIso(event.createdAt)!,
      ticketTypes: types,
      tickets: types,
    };
  });
}

export async function getEventById(id: string, client = db) {
  await expireDueOrders(client);

  const [event] = await client.select().from(events).where(eq(events.id, id));
  if (!event) {
    return null;
  }

  const types = await client
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, id));

  return {
    id: event.id,
    name: event.name,
    startsAt: toIso(event.startsAt)!,
    createdAt: toIso(event.createdAt)!,
    ticketTypes: types,
    tickets: types,
  };
}
