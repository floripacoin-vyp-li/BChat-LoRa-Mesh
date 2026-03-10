import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type MessageInput } from "@shared/routes";
import { buildTextToRadio } from "@/lib/meshtastic";
import { encrypt, formatDmPayload } from "@/lib/crypto";
import { serverReachable, recheckConnectivity } from "@/hooks/use-connectivity";
import { z } from "zod";
import type { Message } from "@shared/schema";

function parseWithLogging<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

export function useMessages() {
  return useQuery({
    queryKey: [api.messages.list.path],
    queryFn: async () => {
      const res = await fetch(api.messages.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return parseWithLogging(api.messages.list.responses[200], data, "messages.list");
    },
    // SSE handles real-time updates; skip polling when server is unreachable
    refetchInterval: () => serverReachable ? 10000 : false,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (message: MessageInput) => {
      const validated = api.messages.create.input.parse(message);

      // If this browser has a radio connected, transmit immediately and mark
      // as transmitted so the relay loop does not double-send it.
      let transmitted = false;
      const isUserMessage = validated.sender !== "system" && validated.sender !== "node";
      if (isUserMessage && (window as any).meshtasticSend) {
        try {
          const bytes = buildTextToRadio(validated.content);
          const writeTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("BLE write timed out after 5s")), 5000)
          );
          await Promise.race([(window as any).meshtasticSend(bytes), writeTimeout]);
          transmitted = true;
          console.log("Mesh: Transmitted via", (window as any)._meshtasticTransport, ":", validated.content);
        } catch (err) {
          console.error("Mesh: Transmission failed:", err);
        }
      }

      // When offline: skip server POST, inject into local cache, still transmitted via radio if available
      if (!serverReachable) {
        if (!transmitted) {
          throw new Error(
            (window as any).meshtasticSend
              ? "BLE transmission failed — check radio connection"
              : "No radio connected — connect via BLE to transmit offline"
          );
        }
        console.log("Mesh: Offline — storing outgoing message locally");
        const localMsg: Message = {
          id: Date.now(),
          sender: validated.sender,
          content: validated.content,
          timestamp: new Date(),
          transmitted,
          claimedBy: null,
          loraPacketId: null,
        };
        queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
          if (!prev) return [localMsg];
          if (prev.some((m) => m.id === localMsg.id)) return prev;
          return [...prev, localMsg];
        });
        return localMsg;
      }

      try {
        const res = await fetch(api.messages.create.path, {
          method: api.messages.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validated, transmitted }),
          credentials: "include",
        });

        if (!res.ok) {
          if (res.status === 400) {
            const error = await res.json();
            throw new Error(error.message || "Validation failed");
          }
          throw new Error("Failed to send message");
        }

        const data = await res.json();
        return parseWithLogging(api.messages.create.responses[201], data, "messages.create");
      } catch (fetchErr) {
        // Server unreachable — kick off a connectivity recheck so the UI updates fast
        recheckConnectivity().catch(() => {});

        if (transmitted) {
          // Message already went over the radio — store locally and succeed silently
          console.log("Mesh: Server unreachable but message was transmitted via radio — caching locally");
          const localMsg: Message = {
            id: Date.now(),
            sender: validated.sender,
            content: validated.content,
            timestamp: new Date(),
            transmitted: true,
            claimedBy: null,
            loraPacketId: null,
          };
          queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
            if (!prev) return [localMsg];
            if (prev.some((m) => m.id === localMsg.id)) return prev;
            return [...prev, localMsg];
          });
          return localMsg;
        }

        // Not transmitted and server is gone — fail loudly
        throw fetchErr;
      }
    },
    onSuccess: () => {
      if (serverReachable) {
        queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
      }
    },
  });
}

export interface SendDmInput {
  contactAlias: string;
  content: string;
  myAlias: string;
}

export function useSendPrivateMessage(
  getSharedKey: (alias: string) => Promise<CryptoKey | null>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactAlias, content, myAlias }: SendDmInput) => {
      const sharedKey = await getSharedKey(contactAlias);
      if (!sharedKey) throw new Error(`No shared key for contact "${contactAlias}"`);

      const encrypted = await encrypt(sharedKey, content);
      const dmContent = formatDmPayload(myAlias, encrypted);

      // Transmit over radio if connected
      let transmitted = false;
      if ((window as any).meshtasticSend) {
        try {
          const { buildTextToRadio } = await import("@/lib/meshtastic");
          const bytes = buildTextToRadio(dmContent);
          const writeTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("BLE write timed out after 5s")), 5000)
          );
          await Promise.race([(window as any).meshtasticSend(bytes), writeTimeout]);
          transmitted = true;
        } catch (err) {
          console.error("Mesh: DM transmission failed:", err);
        }
      }

      // Offline: store locally if transmitted via BLE, otherwise fail loudly
      if (!serverReachable) {
        if (!transmitted) {
          throw new Error(
            (window as any).meshtasticSend
              ? "BLE transmission failed — check radio connection"
              : "No radio connected — connect via BLE to transmit offline"
          );
        }
        const localMsg: Message = {
          id: Date.now(),
          sender: myAlias,
          content: dmContent,
          timestamp: new Date(),
          transmitted,
          claimedBy: null,
          loraPacketId: null,
        };
        queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
          if (!prev) return [localMsg];
          if (prev.some((m) => m.id === localMsg.id)) return prev;
          return [...prev, localMsg];
        });
        return localMsg;
      }

      try {
        const res = await fetch(api.messages.create.path, {
          method: api.messages.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: myAlias, content: dmContent, transmitted }),
          credentials: "include",
        });

        if (!res.ok) throw new Error("Failed to send private message");

        const data = await res.json();
        return parseWithLogging(api.messages.create.responses[201], data, "messages.create.dm");
      } catch (fetchErr) {
        recheckConnectivity().catch(() => {});

        if (transmitted) {
          console.log("Mesh: Server unreachable but DM was transmitted via radio — caching locally");
          const localMsg: Message = {
            id: Date.now(),
            sender: myAlias,
            content: dmContent,
            timestamp: new Date(),
            transmitted: true,
            claimedBy: null,
            loraPacketId: null,
          };
          queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
            if (!prev) return [localMsg];
            if (prev.some((m) => m.id === localMsg.id)) return prev;
            return [...prev, localMsg];
          });
          return localMsg;
        }

        throw fetchErr;
      }
    },
    onSuccess: () => {
      if (serverReachable) {
        queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
      }
    },
  });
}

export function useClearMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.messages.clear.path, {
        method: api.messages.clear.method,
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to clear messages");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
    },
  });
}
