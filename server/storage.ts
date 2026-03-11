import { db } from "./db";
import {
  messages,
  users,
  type InsertMessage,
  type Message,
  type User,
} from "@shared/schema";
import { eq, asc, gt, and, notInArray, isNull, gte, sql } from "drizzle-orm";

export interface IStorage {
  getMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  clearMessages(): Promise<void>;
  deleteRecentMessages(hours: number): Promise<number>;
  getPendingMessages(afterId: number): Promise<Message[]>;
  markTransmitted(id: number): Promise<void>;
  claimMessage(id: number, operatorId: string): Promise<boolean>;
  getByLoraPacketId(packetId: string): Promise<Message | null>;
  claimAlias(alias: string, publicKey: string): Promise<"ok" | "taken">;
  getUserByAlias(alias: string): Promise<User | null>;
}

export class DatabaseStorage implements IStorage {
  async getMessages(): Promise<Message[]> {
    return await db.select().from(messages).orderBy(asc(messages.id));
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    if (insertMessage.loraPacketId) {
      const existing = await this.getByLoraPacketId(insertMessage.loraPacketId);
      if (existing) {
        console.log(`[storage] Dedup: loraPacketId ${insertMessage.loraPacketId} already exists (id=${existing.id})`);
        return existing;
      }
    }

    const [message] = await db.insert(messages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async clearMessages(): Promise<void> {
    await db.delete(messages);
  }

  async deleteRecentMessages(hours: number): Promise<number> {
    const cutoff = sql`NOW() - ${hours} * INTERVAL '1 hour'`;
    const result = await db
      .delete(messages)
      .where(gte(messages.timestamp, cutoff))
      .returning({ id: messages.id });
    return result.length;
  }

  async getPendingMessages(afterId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.transmitted, false),
          gt(messages.id, afterId),
          notInArray(messages.sender, ["system", "node"]),
          isNull(messages.claimedBy)
        )
      )
      .orderBy(asc(messages.id));
  }

  async markTransmitted(id: number): Promise<void> {
    await db
      .update(messages)
      .set({ transmitted: true })
      .where(eq(messages.id, id));
  }

  async claimMessage(id: number, operatorId: string): Promise<boolean> {
    const result = await db
      .update(messages)
      .set({ claimedBy: operatorId })
      .where(
        and(
          eq(messages.id, id),
          isNull(messages.claimedBy)
        )
      )
      .returning({ id: messages.id });
    return result.length > 0;
  }

  async getByLoraPacketId(packetId: string): Promise<Message | null> {
    const [msg] = await db
      .select()
      .from(messages)
      .where(eq(messages.loraPacketId, packetId))
      .limit(1);
    return msg ?? null;
  }

  async claimAlias(alias: string, publicKey: string): Promise<"ok" | "taken"> {
    const existing = await this.getUserByAlias(alias);
    if (existing) {
      return existing.publicKey === publicKey ? "ok" : "taken";
    }
    await db.insert(users).values({ alias, publicKey });
    return "ok";
  }

  async getUserByAlias(alias: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.alias, alias))
      .limit(1);
    return user ?? null;
  }
}

export const storage = new DatabaseStorage();
