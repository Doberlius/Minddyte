ALTER TABLE "messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "quote_start" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "quote_end" integer;