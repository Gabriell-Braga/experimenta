CREATE TABLE "memberships" (
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" DEFAULT 'editor' NOT NULL,
	"can_publish_js" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
-- Cada usuário existente vira membro da sua conta com o papel que tinha.
INSERT INTO "memberships" ("account_id", "user_id", "role", "can_publish_js", "created_at") SELECT "account_id", "id", "role", "can_publish_js", "created_at" FROM "users";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "can_publish_js";