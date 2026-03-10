import { db } from "./db";
import {
  messages,
  type InsertMessage,
  type Message
} from "@shared/schema";
import { eq, asc, gt, and, notInArray } from "drizzle-orm";

export interface IStorage {
  getMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  clearMessages(): Promise<void>;
  getPendingMessages(afterId: number): Promise<Message[]>;
  markTransmitted(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getMessages(): Promise<Message[]> {
    return await db.select().from(messages).orderBy(asc(messages.id));
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async clearMessages(): Promise<void> {
    await db.delete(messages);
  }

  async getPendingMessages(afterId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.transmitted, false),
          gt(messages.id, afterId),
          notInArray(messages.sender, ["system", "node"])
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
}

export const storage = new DatabaseStorage();
