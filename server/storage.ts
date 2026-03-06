import { db } from "./db";
import {
  messages,
  type InsertMessage,
  type Message
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  getMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  clearMessages(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getMessages(): Promise<Message[]> {
    return await db.select().from(messages);
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
}

export const storage = new DatabaseStorage();
