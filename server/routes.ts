import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get(api.messages.list.path, async (req, res) => {
    try {
      const messagesList = await storage.getMessages();
      res.json(messagesList);
    } catch (err) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  app.post(api.messages.create.path, async (req, res) => {
    try {
      const input = api.messages.create.input.parse(req.body);
      const message = await storage.createMessage(input);
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

  app.delete(api.messages.clear.path, async (req, res) => {
    try {
      await storage.clearMessages();
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Failed to clear messages" });
    }
  });

  return httpServer;
}

// Seed the database with some example messages
async function seedDatabase() {
  try {
    const existingMessages = await storage.getMessages();
    if (existingMessages.length === 0) {
      await storage.createMessage({
        sender: 'system',
        content: 'Welcome to the Bit Chat Meshtastic Bridge. Use the "Connect" button to pair with a local Meshtastic node via Bluetooth Low Energy (BLE).'
      });
    }
  } catch (err) {
    console.error('Error seeding database:', err);
  }
}

// Call seed inside a promise so it doesn't block startup
seedDatabase().catch(console.error);
