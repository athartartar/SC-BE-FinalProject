CREATE TABLE "webhook_events" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;