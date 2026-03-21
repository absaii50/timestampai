import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userCreditsTable = pgTable("user_credits", {
  userEmail: text("user_email").primaryKey(),
  credits: integer("credits").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserCreditSchema = createInsertSchema(userCreditsTable);
export type InsertUserCredit = z.infer<typeof insertUserCreditSchema>;
export type UserCredit = typeof userCreditsTable.$inferSelect;
