import { pgTable, text, serial, timestamp, boolean, uniqueIndex, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  sender: text("sender").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  transmitted: boolean("transmitted").notNull().default(false),
  claimedBy: text("claimed_by"),
  loraPacketId: text("lora_packet_id"),
}, (table) => ({
  loraPacketIdUniq: uniqueIndex("messages_lora_packet_id_unique").on(table.loraPacketId),
}));

export const insertMessageSchema = createInsertSchema(messages)
  .omit({ id: true, timestamp: true })
  .extend({
    transmitted: z.boolean().optional(),
    claimedBy: z.string().optional(),
    loraPacketId: z.string().optional(),
  });

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  alias: text("alias").notNull(),
  publicKey: text("public_key").notNull(),
  bchAddress: text("bch_address"),
  registeredAt: timestamp("registered_at").defaultNow(),
  freedAt: timestamp("freed_at"),
}, (table) => ({
  aliasUniq: uniqueIndex("users_alias_unique").on(table.alias),
}));

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, registeredAt: true })
  .extend({ bchAddress: z.string().optional() });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const bugReports = pgTable("bug_reports", {
  id: serial("id").primaryKey(),
  alias: text("alias").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  analysisNote: text("analysis_note"),
  score: integer("score").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBugReportSchema = createInsertSchema(bugReports)
  .omit({ id: true, status: true, analysisNote: true, score: true, createdAt: true })
  .extend({
    category: z.enum(["bug", "ux", "feature", "other"]),
    description: z.string().min(20, "Please describe the issue in at least 20 characters").max(1000),
    alias: z.string().min(1),
  });

export type InsertBugReport = z.infer<typeof insertBugReportSchema>;
export type BugReport = typeof bugReports.$inferSelect;

export const premiumUsers = pgTable("premium_users", {
  id: serial("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  email: text("email").notNull(),
  paymentMethod: text("payment_method"),
  paymentNote: text("payment_note"),
  paymentProof: text("payment_proof"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertPremiumUserSchema = createInsertSchema(premiumUsers)
  .omit({ id: true, status: true, createdAt: true, expiresAt: true })
  .extend({
    alias: z.string().min(1),
    email: z.string().email("Please enter a valid email address"),
    paymentMethod: z.string().optional(),
    paymentNote: z.string().optional(),
    paymentProof: z.string().optional(),
  });

export type InsertPremiumUser = z.infer<typeof insertPremiumUserSchema>;
export type PremiumUser = typeof premiumUsers.$inferSelect;

// ── Payment config (admin-configurable) ────────────────────────────────────
export const paymentConfig = pgTable("payment_config", {
  id: serial("id").primaryKey(),
  lightningAddress: text("lightning_address").notNull().default(""),
  bchAddress: text("bch_address").notNull().default(""),
  btcAddress: text("btc_address").notNull().default(""),
  liquidAddress: text("liquid_address").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PaymentConfig = typeof paymentConfig.$inferSelect;

// ── Email verification codes ────────────────────────────────────────────────
export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
});
