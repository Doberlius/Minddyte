CREATE TABLE "chat_pointers" (
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"match_text" text NOT NULL,
	CONSTRAINT "chat_pointers_message_id_ordinal_pk" PRIMARY KEY("message_id","ordinal"),
	CONSTRAINT "chat_pointers_kind_check" CHECK ("chat_pointers"."kind" in ('sentence', 'code', 'table')),
	CONSTRAINT "chat_pointers_span_check" CHECK ("chat_pointers"."start_char" >= 0 and "chat_pointers"."end_char" > "chat_pointers"."start_char")
);
--> statement-breakpoint
CREATE TABLE "data_migrations" (
	"name" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_pointers" ADD CONSTRAINT "chat_pointers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_pointers" ADD CONSTRAINT "chat_pointers_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_pointers_session" ON "chat_pointers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_chat_pointers_match_trgm" ON "chat_pointers" USING gin ("match_text" gin_trgm_ops);