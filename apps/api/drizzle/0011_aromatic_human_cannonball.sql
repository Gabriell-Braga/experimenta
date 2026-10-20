CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_name" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("account_id","target_id","created_at");