import { pgTable, text, serial, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
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
  registeredAt: timestamp("registered_at").defaultNow(),
}, (table) => ({
  aliasUniq: uniqueIndex("users_alias_unique").on(table.alias),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, registeredAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
