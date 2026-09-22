CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "cluster_origins" (
	"workspace_id" uuid NOT NULL,
	"cluster_key" text NOT NULL,
	"x" "float4" NOT NULL,
	"y" "float4" NOT NULL,
	CONSTRAINT "cluster_origins_workspace_id_cluster_key_pk" PRIMARY KEY("workspace_id","cluster_key")
);
--> statement-breakpoint
CREATE TABLE "collection_nodes" (
	"collection_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "collection_nodes_collection_id_node_id_pk" PRIMARY KEY("collection_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forgotten" (
	"session_id" uuid NOT NULL,
	"node_label" text NOT NULL,
	CONSTRAINT "forgotten_session_id_node_label_pk" PRIMARY KEY("session_id","node_label")
);
--> statement-breakpoint
CREATE TABLE "graph_positions" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"x" "float4" DEFAULT 0 NOT NULL,
	"y" "float4" DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_nodes" (
	"message_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "message_nodes_message_id_node_id_pk" PRIMARY KEY("message_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"canonical_key" text NOT NULL,
	"type" text DEFAULT 'General' NOT NULL,
	"summary" text,
	"chat_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"last_referenced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_workspace_canonical_unique" UNIQUE("workspace_id","canonical_key")
);
--> statement-breakpoint
CREATE TABLE "rejected_phrases" (
	"workspace_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	CONSTRAINT "rejected_phrases_workspace_id_phrase_pk" PRIMARY KEY("workspace_id","phrase")
);
--> statement-breakpoint
CREATE TABLE "session_nodes" (
	"session_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_nodes_session_id_node_id_pk" PRIMARY KEY("session_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT 'New Session' NOT NULL,
	"preview" text,
	"collection_id" uuid,
	"compaction" text DEFAULT '' NOT NULL,
	"compaction_updated_at" timestamp with time zone,
	"headline_node_id" uuid,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_nodes" ADD CONSTRAINT "collection_nodes_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_nodes" ADD CONSTRAINT "collection_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forgotten" ADD CONSTRAINT "forgotten_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_positions" ADD CONSTRAINT "graph_positions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_nodes" ADD CONSTRAINT "message_nodes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_nodes" ADD CONSTRAINT "message_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_nodes" ADD CONSTRAINT "session_nodes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_nodes" ADD CONSTRAINT "session_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collections_one_featured" ON "collections" USING btree ("workspace_id","featured") WHERE "collections"."featured" = true;--> statement-breakpoint
CREATE INDEX "idx_message_nodes_node" ON "message_nodes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_session_nodes_node" ON "session_nodes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_updated" ON "sessions" USING btree ("updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_nodes_label_trgm" ON "nodes" USING gin ("label" gin_trgm_ops);