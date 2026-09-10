CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_dead_letter" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outbox_id" bigint NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"retry_count" integer NOT NULL,
	"failure_reason" text NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("id") WHERE "outbox"."processed_at" IS NULL;