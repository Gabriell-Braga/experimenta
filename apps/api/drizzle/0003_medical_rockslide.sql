ALTER TABLE "events" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "events_account_ts_idx" ON "events" USING btree ("account_id","ts");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("account_id","session_id");--> statement-breakpoint
CREATE INDEX "events_visitor_idx" ON "events" USING btree ("account_id","visitor_id");