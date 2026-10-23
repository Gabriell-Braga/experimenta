CREATE TABLE "daily_stats" (
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "daily_stats_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;