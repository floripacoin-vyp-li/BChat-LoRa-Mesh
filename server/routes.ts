import type { Express, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import type { Message } from "@shared/schema";

// In-memory SSE client registry — all connected browsers
const sseClients = new Set<Response>();

function broadcast(msg: Message): void {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) { sseClients.delete(client); }
  }
}

function broadcastClear(): void {
  const data = `event: clear\ndata: {}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) { sseClients.delete(client); }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
