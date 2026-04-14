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
    refetchInterval: () => serverReachable ? 10000 : false,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (message: MessageInput) => {
      const validated = api.messages.create.input.parse(message);
      const isUserMessage = validated.sender !== "system" && validated.sender !== "node";
      const hasRadio = isUserMessage && !!(window as any).meshtasticSend;

      // Offline: fire-and-forget direct radio write + store locally.
      // The relay doesn't run offline so the direct write is the only TX path.
      if (!serverReachable) {
        if (hasRadio) {
          const bytes = buildTextToRadio(`${validated.sender}: ${validated.content}`);
          Promise.resolve((window as any).meshtasticSend(bytes)).catch((e: unknown) =>
            console.warn("Mesh: radio write failed (offline):", e)
          );
          console.log("Mesh: dispatched offline via", (window as any)._meshtasticTransport);
        }
        const localMsg: Message = {
          id: Date.now(),
          sender: validated.sender,
          content: validated.content,
          timestamp: new Date(),
          transmitted: hasRadio,
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

      // Online: POST to server with transmitted=false so the relay picks it up
      // reliably via its polling + atomic-claim mechanism (2 s poll interval).
      // A direct fire-and-forget write here would mark the message as transmitted
      // even if the BLE GATT write silently failed, causing the relay to skip it.
      try {
        const res = await fetch(api.messages.create.path, {
          method: api.messages.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validated, transmitted: false }),
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
        recheckConnectivity().catch(() => {});
        // Server became unreachable mid-request — store locally
        console.log("Mesh: server unreachable mid-send — caching locally");
        const localMsg: Message = {
          id: Date.now(),
          sender: validated.sender,
          content: validated.content,
          timestamp: new Date(),
          transmitted: hasRadio,
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

      // Fire-and-forget radio write
      const hasRadio = !!(window as any).meshtasticSend;
      if (hasRadio) {
        const { buildTextToRadio: build } = await import("@/lib/meshtastic");
        const bytes = build(dmContent);
        Promise.resolve((window as any).meshtasticSend(bytes)).catch((e: unknown) =>
          console.error("Mesh: DM radio write failed:", e)
        );
      }

      // Offline: store locally
      if (!serverReachable) {
        const localMsg: Message = {
          id: Date.now(),
          sender: myAlias,
          content: dmContent,
          timestamp: new Date(),
          transmitted: hasRadio,
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

      // Online: POST to server
      try {
        const res = await fetch(api.messages.create.path, {
          method: api.messages.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: myAlias, content: dmContent, transmitted: hasRadio }),
          credentials: "include",
        });

        if (!res.ok) throw new Error("Failed to send private message");

        const data = await res.json();
        return parseWithLogging(api.messages.create.responses[201], data, "messages.create.dm");
      } catch (fetchErr) {
        recheckConnectivity().catch(() => {});
        const localMsg: Message = {
          id: Date.now(),
          sender: myAlias,
          content: dmContent,
          timestamp: new Date(),
          transmitted: hasRadio,
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

export function useClearLocalMessages() {
  const queryClient = useQueryClient();
  return {
    clear: () => {
      queryClient.setQueryData<Message[]>([api.messages.list.path], []);
    },
  };
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, alias }: { id: number; alias: string }) => {
      const res = await fetch(`/api/messages/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ alias }),
      });
      if (!res.ok) throw new Error("Failed to delete message");
    },
    onSuccess: (_, { id }) => {
      queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) =>
        prev ? prev.filter((m) => m.id !== id) : []
      );
    },
  });
}
