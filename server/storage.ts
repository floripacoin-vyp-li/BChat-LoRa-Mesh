import { db } from "./db";
import {
  messages,
  users,
  bugReports,
  premiumUsers,
  paymentConfig,
  verificationCodes,
  type InsertMessage,
  type Message,
  type User,
  type InsertBugReport,
  type BugReport,
  type PremiumUser,
  type PaymentConfig,
} from "@shared/schema";
import { eq, asc, gt, and, notInArray, isNull, lt, sql } from "drizzle-orm";

export interface IStorage {
  getMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  clearMessages(): Promise<void>;
  deleteMessagesBySender(alias: string): Promise<void>;
  deleteMessagesOlderThan(hours: number): Promise<number>;
  deleteMessageById(id: number, alias: string): Promise<boolean>;
  getPendingMessages(afterId: number): Promise<Message[]>;
  markTransmitted(id: number): Promise<void>;
  claimMessage(id: number, operatorId: string): Promise<boolean>;
  getByLoraPacketId(packetId: string): Promise<Message | null>;
  claimAlias(alias: string, publicKey: string, bchAddress?: string): Promise<"ok" | "taken">;
  getUserByAlias(alias: string): Promise<User | null>;
  deleteUser(alias: string, publicKey: string): Promise<"ok" | "forbidden" | "not_found">;
  createBugReport(data: InsertBugReport & { analysisNote: string; score: number; status: string }): Promise<BugReport>;
  getBugReports(): Promise<BugReport[]>;
  claimPremium(alias: string, email: string, paymentMethod?: string, paymentAmount?: string, paymentNote?: string, paymentProof?: string): Promise<PremiumUser>;
  getPremiumByAlias(alias: string): Promise<PremiumUser | null>;
  getPremiumByEmail(email: string): Promise<PremiumUser | null>;
  listPremiumUsers(): Promise<PremiumUser[]>;
  approvePremium(id: number): Promise<PremiumUser | null>;
  revokePremium(id: number): Promise<PremiumUser | null>;
  reclaimAlias(alias: string, publicKey: string): Promise<void>;
  createVerificationCode(email: string, code: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<boolean>;
  getPaymentConfig(): Promise<PaymentConfig | null>;
  upsertPaymentConfig(data: { lightningAddress: string; bchAddress: string; btcAddress: string; liquidAddress: string }): Promise<PaymentConfig>;
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

  async deleteMessagesBySender(alias: string): Promise<void> {
    await db.delete(messages).where(eq(messages.sender, alias));
  }

  async deleteMessagesOlderThan(hours: number): Promise<number> {
    const cutoff = sql`NOW() - ${hours} * INTERVAL '1 hour'`;
    const result = await db
      .delete(messages)
      .where(lt(messages.timestamp, cutoff))
      .returning({ id: messages.id });
    return result.length;
  }

  async deleteMessageById(id: number, alias: string): Promise<boolean> {
    const result = await db
      .delete(messages)
      .where(and(eq(messages.id, id), eq(messages.sender, alias)))
      .returning({ id: messages.id });
    return result.length > 0;
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

  // Internal: returns any row for an alias regardless of freedAt status
  private async getAliasRow(alias: string): Promise<User | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.alias}) = lower(${alias})`)
      .limit(1);
    return row ?? null;
  }

  async claimAlias(alias: string, publicKey: string, bchAddress?: string): Promise<"ok" | "taken"> {
    const row = await this.getAliasRow(alias);

    if (row) {
      // Active registration (not freed)
      if (!row.freedAt) {
        // Auto-expire random (non-email) aliases after 1 week
        const isEmailAlias = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias);
        if (!isEmailAlias && row.registeredAt) {
          const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (new Date(row.registeredAt) < oneWeekAgo) {
            await db.update(users).set({ freedAt: new Date() }).where(eq(users.id, row.id));
            return "taken";
          }
        }
        if (row.publicKey !== publicKey) return "taken";
        if (bchAddress) {
          await db.update(users).set({ bchAddress }).where(eq(users.id, row.id));
        }
        return "ok";
      }

      // Soft-deleted — enforce 1-week hold before anyone can re-register it
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (row.freedAt > oneWeekAgo) return "taken";

      // Hold expired — take over the alias slot
      await db
        .update(users)
        .set({ publicKey, bchAddress: bchAddress ?? row.bchAddress, freedAt: null, registeredAt: new Date() })
        .where(eq(users.id, row.id));
      return "ok";
    }

    try {
      await db.insert(users).values({ alias, publicKey, bchAddress: bchAddress ?? null });
      return "ok";
    } catch (err: any) {
      // Unique constraint violation → alias was just taken by a concurrent request
      if (err?.code === "23505") return "taken";
      throw err;
    }
  }

  async getUserByAlias(alias: string): Promise<User | null> {
    // Case-insensitive match; exclude soft-deleted (freed) users
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.alias}) = lower(${alias}) AND ${users.freedAt} IS NULL`)
      .limit(1);
    return user ?? null;
  }

  async deleteUser(alias: string, publicKey: string): Promise<"ok" | "forbidden" | "not_found"> {
    const user = await this.getUserByAlias(alias);
    if (!user) return "not_found";
    if (user.publicKey !== publicKey) return "forbidden";
    // Soft-delete: preserve the row so the alias stays reserved for 1 week
    await db.update(users).set({ freedAt: new Date() }).where(eq(users.id, user.id));
    return "ok";
  }

  async createBugReport(data: InsertBugReport & { analysisNote: string; score: number; status: string }): Promise<BugReport> {
    const [report] = await db.insert(bugReports).values(data).returning();
    return report;
  }

  async getBugReports(): Promise<BugReport[]> {
    return await db.select().from(bugReports).orderBy(asc(bugReports.createdAt));
  }

  async claimPremium(alias: string, email: string, paymentMethod?: string, paymentAmount?: string, paymentNote?: string, paymentProof?: string): Promise<PremiumUser> {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const [existing] = await db.select().from(premiumUsers).where(eq(premiumUsers.alias, alias)).limit(1);
    if (existing) {
      const [updated] = await db
        .update(premiumUsers)
        .set({ email, paymentMethod: paymentMethod ?? null, paymentAmount: paymentAmount ?? null, paymentNote: paymentNote ?? null, paymentProof: paymentProof ?? null, status: "pending", expiresAt })
        .where(eq(premiumUsers.alias, alias))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(premiumUsers)
      .values({ alias, email, paymentMethod: paymentMethod ?? null, paymentAmount: paymentAmount ?? null, paymentNote: paymentNote ?? null, paymentProof: paymentProof ?? null, status: "pending", expiresAt })
      .returning();
    return created;
  }

  async listPremiumUsers(): Promise<PremiumUser[]> {
    return await db.select().from(premiumUsers).orderBy(asc(premiumUsers.createdAt));
  }

  async approvePremium(id: number): Promise<PremiumUser | null> {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const [updated] = await db
      .update(premiumUsers)
      .set({ status: "active", expiresAt })
      .where(eq(premiumUsers.id, id))
      .returning();
    return updated ?? null;
  }

  async revokePremium(id: number): Promise<PremiumUser | null> {
    const [updated] = await db
      .update(premiumUsers)
      .set({ status: "revoked" })
      .where(eq(premiumUsers.id, id))
      .returning();
    return updated ?? null;
  }

  async getPremiumByAlias(alias: string): Promise<PremiumUser | null> {
    const [row] = await db.select().from(premiumUsers).where(eq(premiumUsers.alias, alias)).limit(1);
    return row ?? null;
  }

  async getPremiumByEmail(email: string): Promise<PremiumUser | null> {
    const [row] = await db
      .select()
      .from(premiumUsers)
      .where(sql`lower(${premiumUsers.email}) = lower(${email})`)
      .limit(1);
    return row ?? null;
  }

  async reclaimAlias(alias: string, publicKey: string): Promise<void> {
    await db
      .update(users)
      .set({ publicKey, freedAt: null, registeredAt: new Date() })
      .where(sql`lower(${users.alias}) = lower(${alias})`);
    // Update the premium record's alias to the email alias (in case it was
    // stored under an old random alias when the user first applied for premium)
    await db
      .update(premiumUsers)
      .set({ alias })
      .where(sql`lower(${premiumUsers.email}) = lower(${alias})`);
  }

  async createVerificationCode(email: string, code: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await db.delete(verificationCodes).where(eq(verificationCodes.email, email));
    await db.insert(verificationCodes).values({ email, code, expiresAt });
  }

  async verifyCode(email: string, code: string): Promise<boolean> {
    const now = new Date();
    const [row] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.email, email),
          eq(verificationCodes.code, code),
          eq(verificationCodes.used, false),
          gt(verificationCodes.expiresAt, now),
        )
      )
      .limit(1);
    if (!row) return false;
    await db
      .update(verificationCodes)
      .set({ used: true })
      .where(eq(verificationCodes.id, row.id));
    return true;
  }

  async getPaymentConfig(): Promise<PaymentConfig | null> {
    const [row] = await db.select().from(paymentConfig).where(eq(paymentConfig.id, 1)).limit(1);
    return row ?? null;
  }

  async upsertPaymentConfig(data: { lightningAddress: string; bchAddress: string; btcAddress: string; liquidAddress: string }): Promise<PaymentConfig> {
    const [existing] = await db.select().from(paymentConfig).where(eq(paymentConfig.id, 1)).limit(1);
    if (existing) {
      const [updated] = await db
        .update(paymentConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(paymentConfig.id, 1))
        .returning();
      return updated;
    }
    const [created] = await db.insert(paymentConfig).values({ id: 1, ...data }).returning();
    return created;
  }

}

export const storage = new DatabaseStorage();
