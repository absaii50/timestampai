import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  provider: text("provider").notNull(), // "lemonsqueezy" | "cryptomus"
  externalId: text("external_id").notNull(), // provider's payment/order ID
  status: text("status").notNull().default("pending"), // pending | paid | failed
  creditsAwarded: integer("credits_awarded").notNull().default(0),
  amountUsd: text("amount_usd"),
  planName: text("plan_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
