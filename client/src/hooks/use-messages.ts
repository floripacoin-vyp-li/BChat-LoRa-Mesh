import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type MessageInput } from "@shared/routes";
import { buildTextToRadio } from "@/lib/meshtastic";
import { z } from "zod";

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
    // SSE handles real-time updates; this is a safety net for any missed events
    refetchInterval: 10000,
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
          await (window as any).meshtasticSend(bytes);
          transmitted = true;
          console.log("Mesh: Transmitted via", (window as any)._meshtasticTransport, ":", validated.content);
        } catch (err) {
          console.error("Mesh: Transmission failed:", err);
        }
      }

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
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
