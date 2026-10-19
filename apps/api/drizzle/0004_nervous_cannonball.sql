CREATE TABLE "recording_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"session_id" text NOT NULL,
	"first_ts" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"session_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"pages" jsonb NOT NULL,
	"device" text NOT NULL,
	"vw" integer NOT NULL,
	"vh" integer NOT NULL,
	"events" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording_chunks" ADD CONSTRAINT "recording_chunks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_chunks_session_idx" ON "recording_chunks" USING btree ("account_id","session_id","first_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_session_uq" ON "recordings" USING btree ("account_id","session_id");--> statement-breakpoint
CREATE INDEX "recordings_started_idx" ON "recordings" USING btree ("account_id","started_at");