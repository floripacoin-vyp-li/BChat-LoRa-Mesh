import type { Express, Response } from "express";
import type { Server } from "http";
import os from "os";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import type { Message } from "@shared/schema";

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

  // ── Clear messages ────────────────────────────────────────────────────────
  app.delete(api.messages.clear.path, async (req, res) => {
    try {
      await storage.clearMessages();
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
    alias: z.string().min(2).max(24),
    publicKey: z.string().min(1),
  });

  const RESERVED_ALIASES = new Set(["system", "node", "gateway", "broadcast", "server", "admin"]);

  app.post("/api/users/claim", async (req, res) => {
    try {
      const { alias, publicKey } = claimAliasSchema.parse(req.body);
      if (RESERVED_ALIASES.has(alias.toLowerCase())) {
        return res.status(409).json({ ok: false, message: "Alias already taken" });
      }
      const result = await storage.claimAlias(alias, publicKey);
      if (result === "ok") {
        res.json({ ok: true });
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

  app.get("/api/users/:alias", async (req, res) => {
    try {
      const alias = req.params.alias;
      const user = await storage.getUserByAlias(alias);
      if (!user) return res.status(404).json({ message: "Alias not found" });
      res.json({ alias: user.alias, publicKey: user.publicKey });
    } catch (err) {
      res.status(500).json({ message: "Failed to look up alias" });
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

  return httpServer;
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
