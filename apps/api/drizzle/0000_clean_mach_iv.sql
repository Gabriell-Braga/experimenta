CREATE TYPE "public"."role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('draft', 'running', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"experiment_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" "experiment_status" DEFAULT 'draft' NOT NULL,
	"traffic" real DEFAULT 100 NOT NULL,
	"segmentation" jsonb NOT NULL,
	"anti_flicker" jsonb NOT NULL,
	"editor_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"experiment_id" text NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"definition" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"site_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" DEFAULT 'editor' NOT NULL,
	"can_publish_js" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"experiment_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"weight" integer NOT NULL,
	"operations" jsonb NOT NULL,
	"custom_css" text DEFAULT '' NOT NULL,
	"custom_js" text DEFAULT '' NOT NULL,
	"redirect" jsonb
);
--> statement-breakpoint
ALTER TABLE "experiment_versions" ADD CONSTRAINT "experiment_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_versions" ADD CONSTRAINT "experiment_versions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variations" ADD CONSTRAINT "variations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variations" ADD CONSTRAINT "variations_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versions_exp_version_uq" ON "experiment_versions" USING btree ("experiment_id","version");--> statement-breakpoint
CREATE INDEX "versions_account_idx" ON "experiment_versions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_account_key_uq" ON "experiments" USING btree ("account_id","key");--> statement-breakpoint
CREATE INDEX "experiments_project_idx" ON "experiments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "goals_experiment_idx" ON "goals" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "goals_account_idx" ON "goals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "projects_account_idx" ON "projects" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_account_version_uq" ON "publications" USING btree ("account_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variations_exp_key_uq" ON "variations" USING btree ("experiment_id","key");--> statement-breakpoint
CREATE INDEX "variations_account_idx" ON "variations" USING btree ("account_id");