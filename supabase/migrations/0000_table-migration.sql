CREATE TABLE "cluster_nodes" (
	"cluster_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "cluster_nodes_cluster_id_node_id_pk" PRIMARY KEY("cluster_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"folder_id" uuid,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"type" text DEFAULT 'suggested' NOT NULL,
	"confidence" "float4" DEFAULT 0.5 NOT NULL,
	"relationship_label" text,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edges_unique" UNIQUE("user_id","from_node_id","to_node_id"),
	CONSTRAINT "edges_no_self_loop" CHECK ("edges"."from_node_id" <> "edges"."to_node_id"),
	CONSTRAINT "edges_type_check" CHECK ("edges"."type" in ('confirmed', 'suggested')),
	CONSTRAINT "edges_confidence" CHECK ("edges"."confidence" >= 0 and "edges"."confidence" <=1)
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folders_unique_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "graph_positions" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
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
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'General' NOT NULL,
	"summary" text,
	"confidence" "float4" DEFAULT 1 NOT NULL,
	"connection_count" integer DEFAULT 0 NOT NULL,
	"embedding" extensions.vector(768),
	"last_referenced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_confidence" CHECK ("nodes"."confidence" >= 0 and "nodes"."confidence" <= 1)
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
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New Session' NOT NULL,
	"preview" text,
	"cluster_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_nodes" ADD CONSTRAINT "cluster_nodes_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_nodes" ADD CONSTRAINT "cluster_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_from_node_id_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_to_node_id_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_positions" ADD CONSTRAINT "graph_positions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_positions" ADD CONSTRAINT "graph_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_nodes" ADD CONSTRAINT "message_nodes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_nodes" ADD CONSTRAINT "message_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_nodes" ADD CONSTRAINT "session_nodes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_nodes" ADD CONSTRAINT "session_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cluster_nodes_node" ON "cluster_nodes" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clusters_one_featured" ON "clusters" USING btree ("user_id") WHERE "clusters"."featured" = true;--> statement-breakpoint
CREATE INDEX "idx_clusters_user_id" ON "clusters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_clusters_last_active" ON "clusters" USING btree ("user_id","last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_clusters_folder_id" ON "clusters" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_edges_user_id" ON "edges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_edges_from_node" ON "edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "idx_edges_to_node" ON "edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "idx_edges_both_nodes" ON "edges" USING btree ("from_node_id","to_node_id");--> statement-breakpoint
CREATE INDEX "idx_folders_user_id" ON "folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_graph_positions_user_id" ON "graph_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_message_nodes_node" ON "message_nodes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_messages_session_id" ON "messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_user_id" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_nodes_user_id" ON "nodes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_nodes_last_referenced" ON "nodes" USING btree ("user_id","last_referenced_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_session_nodes_node" ON "session_nodes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_updated" ON "sessions" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sessions_cluster_id" ON "sessions" USING btree ("cluster_id");