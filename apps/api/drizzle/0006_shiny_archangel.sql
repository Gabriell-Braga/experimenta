ALTER TABLE "experiments" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "extra" jsonb DEFAULT '{}'::jsonb NOT NULL;