import type { Express, Response } from "express";
import type { Server } from "http";
import os from "os";
import nodemailer from "nodemailer";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import type { Message } from "@shared/schema";
import { insertBugReportSchema } from "@shared/schema";

// ── Email transport (nodemailer) ────────────────────────────────────────────
async function getMailTransport() {
  const cfg = await storage.getEmailConfig();
  const host = cfg?.smtpHost || process.env.SMTP_HOST || "";
  const port = cfg?.smtpPort || Number(process.env.SMTP_PORT ?? 587);
  const user = cfg?.smtpUser || process.env.SMTP_USER || "";
  const pass = cfg?.smtpPass || process.env.SMTP_PASS || "";
  return {
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    }),
    from: cfg?.smtpFrom || process.env.SMTP_FROM || user,
  };
}

async function sendApprovalEmail(to: string, alias: string, expiresAt: Date): Promise<void> {
  const { transport, from } = await getMailTransport();
  await transport.sendMail({
    from,
    to,
    subject: "BCB Premium — your account has been approved!",
    text: `Great news! Your BCB Premium account for alias "${alias}" has been approved and is now active until ${expiresAt.toDateString()}.\n\nAlias: ${alias}\nEmail: ${to}\nActive until: ${expiresAt.toDateString()}\n\nEnjoy your verified badge and wallet backup features.`,
    html: `<div style="font-family:monospace;max-width:420px;margin:auto;padding:24px;background:#0a0a0a;color:#e8e8e8;border-radius:12px;border:1px solid #222">
  <p style="margin:0 0 8px;font-size:13px;color:#888;letter-spacing:.08em;text-transform:uppercase">BCB Premium Approved</p>
  <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#f59e0b">✓ Your account is now active</p>
  <p style="margin:0 0 8px;font-size:12px;color:#aaa">Alias: <strong style="color:#e8e8e8">${alias}</strong></p>
  <p style="margin:0 0 8px;font-size:12px;color:#aaa">Email: <strong style="color:#e8e8e8">${to}</strong></p>
  <p style="margin:0 0 16px;font-size:12px;color:#aaa">Active until: <strong style="color:#e8e8e8">${expiresAt.toDateString()}</strong></p>
  <p style="margin:0;font-size:11px;color:#666">You now have access to wallet backup and a verified badge. Reload the app to see your benefits.</p>
</div>`,
  });
}

async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const { transport, from } = await getMailTransport();
  await transport.sendMail({
    from,
    to,
    subject: "BCB Premium — your verification code",
    text: `Your BCB verification code is: ${code}\n\nIt expires in 15 minutes. Do not share it with anyone.`,
    html: `<div style="font-family:monospace;max-width:420px;margin:auto;padding:24px;background:#0a0a0a;color:#e8e8e8;border-radius:12px;border:1px solid #222">
  <p style="margin:0 0 8px;font-size:13px;color:#888;letter-spacing:.08em;text-transform:uppercase">BCB Premium Verification</p>
  <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:.25em;color:#f59e0b">${code}</p>
  <p style="margin:0;font-size:12px;color:#666">This code expires in 15 minutes. Never share it.</p>
</div>`,
  });
}

// In-memory SSE client registry — all connected browsers
const sseClients = new Set<Response>();

// Operator presence — maps operatorId → last heartbeat timestamp (ms)
const activeOperators = new Map<string, number>();
const OPERATOR_TTL_MS = 20_000;

function broadcastRaw(data: string): void {
  for (const client of sseClients) {
    try { client.write(data); } catch (_) { sseClients.delete(client); }
  }
}

function broadcast(msg: Message): void {
  broadcastRaw(`data: ${JSON.stringify(msg)}\n\n`);
}

function broadcastClear(): void {
  broadcastRaw(`event: clear\ndata: {}\n\n`);
}

function broadcastMessageDeleted(id: number): void {
  broadcastRaw(`event: message-deleted\ndata: ${JSON.stringify({ id })}\n\n`);
}

function broadcastOperatorCount(): void {
  broadcastRaw(`event: operator-status\ndata: ${JSON.stringify({ count: activeOperators.size })}\n\n`);
}

// Prune stale operators every 5 seconds and broadcast if count changed
setInterval(() => {
  const now = Date.now();
  const before = activeOperators.size;
  for (const [id, ts] of activeOperators) {
    if (now - ts > OPERATOR_TTL_MS) activeOperators.delete(id);
  }
  if (activeOperators.size !== before) broadcastOperatorCount();
}, 5_000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Health check ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ── SSE stream ────────────────────────────────────────────────────────────
  app.get(api.messages.stream.path, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    sseClients.add(res);
    console.log(`[SSE] client connected — total: ${sseClients.size}`);

    // Keep-alive ping every 25s (prevents proxy timeouts)
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch (_) { clearInterval(ping); }
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
      console.log(`[SSE] client disconnected — total: ${sseClients.size}`);
    });
  });

  // ── Messages list ─────────────────────────────────────────────────────────
  app.get(api.messages.list.path, async (req, res) => {
    try {
      const messagesList = await storage.getMessages();
      res.json(messagesList);
    } catch (err) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  // ── Create message ────────────────────────────────────────────────────────
  app.post(api.messages.create.path, async (req, res) => {
    try {
      const input = api.messages.create.input.parse(req.body);
      const message = await storage.createMessage(input);
      broadcast(message);
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Failed to create message" });
    }
  });

  // ── Auto-purge: delete messages older than 1 hour every 15 minutes ───────
  const runAutoPurge = async () => {
    try {
      const deleted = await storage.deleteMessagesOlderThan(1);
      if (deleted > 0) {
        console.log(`[purge] Removed ${deleted} message(s) older than 1 hour`);
        broadcastClear();
      }
    } catch (err) {
      console.error("[purge] Auto-purge failed:", err);
    }
  };
  runAutoPurge();
  setInterval(runAutoPurge, 15 * 60 * 1000);

  // ── Delete own message ────────────────────────────────────────────────────
  app.delete("/api/messages/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const { alias } = z.object({ alias: z.string().min(1) }).parse(req.body);
      const deleted = await storage.deleteMessageById(id, alias);
      if (!deleted) return res.status(403).json({ message: "Not authorized or message not found" });
      broadcastMessageDeleted(id);
      res.status(204).end();
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // ── Clear messages ────────────────────────────────────────────────────────
  app.delete(api.messages.clear.path, async (req, res) => {
    try {
      const sender = typeof req.query.sender === "string" ? req.query.sender.trim() : null;
      if (sender) {
        await storage.deleteMessagesBySender(sender);
      } else {
        await storage.clearMessages();
      }
      broadcastClear();
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Failed to clear messages" });
    }
  });

  // ── Pending messages (relay queue) ────────────────────────────────────────
  app.get(api.messages.pending.path, async (req, res) => {
    try {
      const afterId = parseInt(String(req.query.after ?? "0"), 10) || 0;
      const pending = await storage.getPendingMessages(afterId);
      res.json(pending);
    } catch (err) {
      res.status(500).json({ message: "Failed to get pending messages" });
    }
  });

  // ── Mark transmitted ──────────────────────────────────────────────────────
  app.patch("/api/messages/:id/transmitted", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.markTransmitted(id);
      res.json({ id, transmitted: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to mark transmitted" });
    }
  });

  // ── Claim message (atomic — prevents double relay) ────────────────────────
  app.post("/api/messages/:id/claim", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const { operatorId } = req.body;
      if (!operatorId) return res.status(400).json({ message: "operatorId required" });

      const claimed = await storage.claimMessage(id, operatorId);
      if (claimed) {
        res.json({ claimed: true });
      } else {
        res.status(409).json({ claimed: false, message: "Already claimed by another operator" });
      }
    } catch (err) {
      res.status(500).json({ message: "Failed to claim message" });
    }
  });

  // ── Operator heartbeat — tracks which clients have a live radio ───────────
  app.post("/api/operator/heartbeat", (req, res) => {
    const { operatorId } = req.body ?? {};
    if (!operatorId || typeof operatorId !== "string") {
      return res.status(400).json({ message: "operatorId required" });
    }
    const before = activeOperators.size;
    activeOperators.set(operatorId, Date.now());
    if (activeOperators.size !== before) broadcastOperatorCount();
    res.json({ count: activeOperators.size });
  });

  app.delete("/api/operator/heartbeat", (req, res) => {
    const { operatorId } = req.body ?? {};
    if (!operatorId || typeof operatorId !== "string") {
      return res.status(400).json({ message: "operatorId required" });
    }
    const before = activeOperators.size;
    activeOperators.delete(operatorId);
    if (activeOperators.size !== before) broadcastOperatorCount();
    res.json({ count: activeOperators.size });
  });

  app.get("/api/operator/count", (_req, res) => {
    res.json({ count: activeOperators.size });
  });

  // ── Alias claim — registers alias → publicKey binding ────────────────────
  const claimAliasSchema = z.object({
    alias: z.string().min(2).max(254),
    publicKey: z.string().min(1),
    bchAddress: z.string().optional(),
  });

  const RESERVED_ALIASES = new Set(["system", "node", "gateway", "broadcast", "server", "admin"]);
  const EMAIL_ALIAS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.post("/api/users/claim", async (req, res) => {
    try {
      const { alias, publicKey, bchAddress } = claimAliasSchema.parse(req.body);
      if (RESERVED_ALIASES.has(alias.toLowerCase())) {
        return res.status(409).json({ ok: false, message: "Alias already taken" });
      }
      if (EMAIL_ALIAS_RE.test(alias)) {
        const premium = await storage.getPremiumByEmail(alias);
        const isActivePremium = premium && premium.status === "active" && new Date(premium.expiresAt) > new Date();
        if (!isActivePremium) {
          return res.status(400).json({ ok: false, message: "Email addresses are reserved for Premium Verified users." });
        }
      }
      const result = await storage.claimAlias(alias, publicKey, bchAddress);
      if (result === "ok") {
        const user = await storage.getUserByAlias(alias);
        res.json({ ok: true, bchAddress: user?.bchAddress ?? null });
      } else {
        res.status(409).json({ ok: false, message: "Alias already taken" });
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Failed to claim alias" });
    }
  });

  // Reclaim an email alias after OTP verification (proves ownership of that email)
  const reclaimEmailSchema = z.object({
    alias: z.string().email(),
    publicKey: z.string().min(1),
    code: z.string().length(6),
  });

  app.post("/api/users/reclaim-email", async (req, res) => {
    try {
      const { alias, publicKey, code } = reclaimEmailSchema.parse(req.body);
      const valid = await storage.verifyCode(alias, code);
      if (!valid) {
        return res.status(400).json({ ok: false, message: "Invalid or expired verification code." });
      }
      await storage.reclaimAlias(alias, publicKey);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ ok: false, message: err.errors[0].message });
      }
      res.status(500).json({ ok: false, message: "Failed to reclaim alias." });
    }
  });

  app.get("/api/users/:alias", async (req, res) => {
    try {
      const alias = req.params.alias;
      const user = await storage.getUserByAlias(alias);
      if (!user) return res.status(404).json({ message: "Alias not found" });
      res.json({ alias: user.alias, publicKey: user.publicKey, bchAddress: user.bchAddress ?? null });
    } catch (err) {
      res.status(500).json({ message: "Failed to look up alias" });
    }
  });

  // ── Delete user — frees alias for others after reset ─────────────────────
  const deleteUserSchema = z.object({ publicKey: z.string().min(1) });

  app.delete("/api/users/:alias", async (req, res) => {
    try {
      const alias = req.params.alias;
      const { publicKey } = deleteUserSchema.parse(req.body);
      const result = await storage.deleteUser(alias, publicKey);
      if (result === "ok") return res.status(204).end();
      if (result === "forbidden") return res.status(403).json({ message: "Public key mismatch" });
      return res.status(404).json({ message: "Alias not found" });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ── Local network info — used by QR "Scan to Join" to build hotspot URL ───
  app.get("/api/network-info", (req, res) => {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 5000;
    const interfaces = os.networkInterfaces();
    let localIp: string | null = null;

    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (
          addr.family === "IPv4" &&
          !addr.internal &&
          (addr.address.startsWith("192.168.") || addr.address.startsWith("10."))
        ) {
          localIp = addr.address;
          break;
        }
      }
      if (localIp) break;
    }

    const localUrl = localIp ? `http://${localIp}:${port}` : null;
    res.json({ localUrl, port });
  });

  // ── Crypto price proxy (CoinGecko free API, cached 60 s) ─────────────────
  let priceCache: { data: Record<string, number>; at: number } | null = null;

  app.get("/api/prices", async (_req, res) => {
    try {
      const now = Date.now();
      if (priceCache && now - priceCache.at < 60_000) {
        return res.json(priceCache.data);
      }
      const upstream = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash,bitcoin&vs_currencies=usd,eur,brl",
        { signal: AbortSignal.timeout(6000) }
      );
      if (!upstream.ok) throw new Error(`CoinGecko ${upstream.status}`);
      const json = await upstream.json() as Record<string, { usd: number; eur?: number; brl?: number }>;
      const btcUsd = json["bitcoin"]?.usd ?? 0;
      const btcEur = json["bitcoin"]?.eur ?? 0;
      const btcBrl = json["bitcoin"]?.brl ?? 0;
      const data = {
        bch:    json["bitcoin-cash"]?.usd ?? 0,
        btc:    btcUsd,
        // Derived forex rates: how many EUR / BRL equal 1 USD
        eurPerUsd: btcUsd > 0 && btcEur > 0 ? btcEur / btcUsd : 0,
        brlPerUsd: btcUsd > 0 && btcBrl > 0 ? btcBrl / btcUsd : 0,
      };
      priceCache = { data, at: now };
      res.json(data);
    } catch {
      if (priceCache) return res.json(priceCache.data);
      res.status(503).json({ bch: 0, btc: 0, eurPerUsd: 0, brlPerUsd: 0 });
    }
  });

  // ── Bug reports ────────────────────────────────────────────────────────────
  app.post("/api/bug-reports", async (req, res) => {
    try {
      const input = insertBugReportSchema.parse(req.body);
      const { score, analysisNote, status } = analyzeBugReport(input.description, input.category);
      const report = await storage.createBugReport({ ...input, score, analysisNote, status });
      res.status(201).json({ ok: true, id: report.id, status, analysisNote });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ ok: false, message: err.errors[0].message });
      }
      res.status(500).json({ ok: false, message: "Failed to submit report" });
    }
  });

  // ── Premium users ──────────────────────────────────────────────────────────

  app.get("/api/premium/status/:alias", async (req, res) => {
    try {
      const { alias } = req.params;
      const decoded = decodeURIComponent(alias);
      let record = await storage.getPremiumByAlias(decoded);
      if (!record) record = await storage.getPremiumByEmail(decoded);
      if (!record || record.status !== "active" || new Date(record.expiresAt) < new Date()) {
        return res.json({ isPremium: false });
      }
      return res.json({
        isPremium: true,
        email: record.email,
        expiresAt: record.expiresAt,
      });
    } catch {
      res.status(500).json({ isPremium: false });
    }
  });

  // Check whether an email belongs to an active Premium account (for alias validation)
  app.get("/api/premium/check-email/:email", async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const record = await storage.getPremiumByEmail(email);
      const isPremium = !!(record && record.status === "active" && new Date(record.expiresAt) > new Date());
      return res.json({ isPremium });
    } catch {
      res.status(500).json({ isPremium: false });
    }
  });

  // Send a 6-digit verification code to the given email
  app.post("/api/premium/send-code", async (req, res) => {
    try {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await storage.createVerificationCode(email, code);
      await sendVerificationEmail(email, code);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ ok: false, message: err.errors[0].message });
      }
      console.error("send-code error:", err);
      res.status(500).json({ ok: false, message: "Failed to send verification code" });
    }
  });

  // Verify the code and then activate premium for the alias
  const claimPremiumSchema = z.object({
    alias: z.string().min(1),
    email: z.string().email(),
    code: z.string().length(6),
    paymentMethod: z.string().optional(),
    paymentAmount: z.string().optional(),
    paymentNote: z.string().optional(),
    paymentProof: z.string().optional(),
  });

  app.post("/api/premium/claim", async (req, res) => {
    try {
      const { alias, email, code, paymentMethod, paymentAmount, paymentNote, paymentProof } = claimPremiumSchema.parse(req.body);
      const valid = await storage.verifyCode(email, code);
      if (!valid) {
        return res.status(400).json({ ok: false, message: "Invalid or expired verification code." });
      }
      const record = await storage.claimPremium(alias, email, paymentMethod, paymentAmount, paymentNote, paymentProof);
      return res.status(201).json({ ok: true, status: record.status, expiresAt: record.expiresAt });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ ok: false, message: err.errors[0].message });
      }
      res.status(500).json({ ok: false, message: "Failed to submit premium request" });
    }
  });

  // ── Admin — protected by ADMIN_KEY env secret ──────────────────────────────
  function adminAuth(req: any, res: any, next: any) {
    const key = process.env.ADMIN_KEY;
    if (!key) return res.status(503).json({ message: "Admin key not configured" });
    if (req.headers["x-admin-key"] !== key) return res.status(401).json({ message: "Unauthorized" });
    next();
  }

  app.get("/api/admin/premium", adminAuth, async (_req, res) => {
    try {
      const users = await storage.listPremiumUsers();
      res.json(users);
    } catch {
      res.status(500).json({ message: "Failed to list premium users" });
    }
  });

  app.post("/api/admin/premium/:id/approve", adminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const record = await storage.approvePremium(id);
      if (!record) return res.status(404).json({ message: "Not found" });
      try {
        await sendApprovalEmail(record.email, record.alias, record.expiresAt);
      } catch (emailErr) {
        console.error("[admin] Approval email failed:", emailErr);
      }
      res.json({ ok: true, record });
    } catch {
      res.status(500).json({ message: "Failed to approve" });
    }
  });

  app.post("/api/admin/premium/:id/revoke", adminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const record = await storage.revokePremium(id);
      if (!record) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true, record });
    } catch {
      res.status(500).json({ message: "Failed to revoke" });
    }
  });

  // ── Payment config ─────────────────────────────────────────────────────────

  app.get("/api/config/payment", async (_req, res) => {
    try {
      const config = await storage.getPaymentConfig();
      res.json(config ?? { lightningAddress: "", bchAddress: "", btcAddress: "", liquidAddress: "", premiumPriceUsd: 10 });
    } catch {
      res.status(500).json({ message: "Failed to load payment config" });
    }
  });

  app.put("/api/admin/payment-config", adminAuth, async (req, res) => {
    try {
      const schema = z.object({
        lightningAddress: z.string().max(200),
        bchAddress: z.string().max(200),
        btcAddress: z.string().max(200),
        liquidAddress: z.string().max(200),
        premiumPriceUsd: z.number().positive().max(10000),
      });
      const data = schema.parse(req.body);
      const config = await storage.upsertPaymentConfig(data);
      res.json({ ok: true, config });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Failed to save payment config" });
    }
  });

  app.get("/api/admin/financial-stats", adminAuth, async (req, res) => {
    try {
      const config = await storage.getPaymentConfig();
      const priceUsd = config?.premiumPriceUsd ?? 10;
      const stats = await storage.getFinancialStats(priceUsd);
      res.json({ priceUsd, ...stats });
    } catch {
      res.status(500).json({ message: "Failed to load financial stats" });
    }
  });

  // ── Email config ────────────────────────────────────────────────────────────

  app.get("/api/admin/email-config", adminAuth, async (_req, res) => {
    try {
      const cfg = await storage.getEmailConfig();
      res.json({
        smtpHost: cfg?.smtpHost ?? "",
        smtpPort: cfg?.smtpPort ?? 587,
        smtpUser: cfg?.smtpUser ?? "",
        smtpPassSet: !!(cfg?.smtpPass),
        smtpFrom: cfg?.smtpFrom ?? "",
        updatedAt: cfg?.updatedAt ?? null,
      });
    } catch {
      res.status(500).json({ message: "Failed to load email config" });
    }
  });

  app.put("/api/admin/email-config", adminAuth, async (req, res) => {
    try {
      const schema = z.object({
        smtpHost: z.string().max(300),
        smtpPort: z.number().int().min(1).max(65535),
        smtpUser: z.string().max(300),
        smtpPass: z.string().max(500).optional(),
        smtpFrom: z.string().max(300),
      });
      const data = schema.parse(req.body);
      const cfg = await storage.upsertEmailConfig(data);
      res.json({
        ok: true,
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        smtpUser: cfg.smtpUser,
        smtpPassSet: !!cfg.smtpPass,
        smtpFrom: cfg.smtpFrom,
        updatedAt: cfg.updatedAt,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Failed to save email config" });
    }
  });

  app.post("/api/admin/email-test", adminAuth, async (req, res) => {
    try {
      const { to } = z.object({ to: z.string().email() }).parse(req.body);
      const { transport, from } = await getMailTransport();
      await transport.sendMail({
        from,
        to,
        subject: "BCB Admin — SMTP test",
        text: `This is a test email from BCB Admin panel sent at ${new Date().toISOString()}.`,
        html: `<div style="font-family:monospace;padding:16px;background:#0a0a0a;color:#e8e8e8;border-radius:8px"><p style="color:#f59e0b;margin:0 0 8px;font-size:14px">✓ BCB SMTP test successful</p><p style="margin:0;font-size:12px;color:#888">Sent at ${new Date().toISOString()}</p></div>`,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to send test email" });
    }
  });

  return httpServer;
}

function analyzeBugReport(description: string, category: string): { score: number; analysisNote: string; status: string } {
  const text = description.trim().toLowerCase();
  let score = 0;
  const notes: string[] = [];

  // Length check
  if (text.length >= 80) { score += 25; }
  else if (text.length >= 40) { score += 15; }
  else { score += 5; notes.push("description is quite short"); }

  // Gibberish check: high ratio of repeated chars or non-word chars
  const nonWordRatio = (text.match(/[^a-z0-9\s.,!?'-]/g) ?? []).length / text.length;
  if (nonWordRatio > 0.35) { score -= 20; notes.push("description contains many non-standard characters"); }

  // Repeated char runs (e.g. "aaaaaaa")
  if (/(.)\1{5,}/.test(text)) { score -= 20; notes.push("description appears to contain repetitive characters"); }

  // Unique word count — more distinct words = more meaningful
  const words = text.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words).size;
  if (uniqueWords >= 10) score += 20;
  else if (uniqueWords >= 5) score += 10;
  else { notes.push("description has very few distinct words"); }

  // Category-relevant keyword signals
  const bugKeywords = ["error", "broken", "crash", "fail", "doesn't work", "not working", "bug", "glitch", "wrong", "issue", "problem", "stuck", "freeze"];
  const uxKeywords = ["confusing", "unclear", "hard to", "difficult", "improve", "suggest", "interface", "ui", "layout", "button", "tap", "click"];
  const featureKeywords = ["add", "would be nice", "feature", "support", "allow", "enable", "request", "want", "could", "should"];

  const relevantKw = category === "bug" ? bugKeywords : category === "ux" ? uxKeywords : category === "feature" ? featureKeywords : [...bugKeywords, ...uxKeywords];
  const matchedKw = relevantKw.filter((kw) => text.includes(kw));
  if (matchedKw.length >= 2) { score += 25; }
  else if (matchedKw.length === 1) { score += 12; }
  else { notes.push("description doesn't mention any common issue keywords"); }

  // Sentence structure signal: contains at least one sentence-ending punctuation
  if (/[.!?]/.test(text)) score += 10;

  // Cap score
  score = Math.max(0, Math.min(100, score));

  let status: string;
  let notePrefix: string;
  if (score >= 55) {
    status = "likely_valid";
    notePrefix = "Report appears detailed and relevant.";
  } else if (score >= 30) {
    status = "needs_review";
    notePrefix = "Report needs manual review.";
  } else {
    status = "likely_invalid";
    notePrefix = "Report may not contain actionable information.";
  }

  const analysisNote = notes.length > 0
    ? `${notePrefix} Notes: ${notes.join("; ")}.`
    : notePrefix;

  return { score, analysisNote, status };
}

async function seedDatabase() {
  try {
    const existingMessages = await storage.getMessages();
    if (existingMessages.length === 0) {
      await storage.createMessage({
        sender: 'system',
        content: 'Welcome to the Bit Chat Meshtastic Bridge. Use the "Connect" button to pair with a local Meshtastic node via Bluetooth Low Energy (BLE).',
        transmitted: true,
      });
    }
  } catch (err) {
    console.error('Error seeding database:', err);
  }
}

seedDatabase().catch(console.error);
