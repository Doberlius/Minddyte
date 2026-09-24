CREATE TABLE "user_core" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
