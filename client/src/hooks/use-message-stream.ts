import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { Message } from "@shared/schema";

export function useMessageStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource(api.messages.stream.path);

    es.onopen = () => {
      console.log("[SSE] Connected to message stream");
    };

    // Default event: a new message was created
    es.onmessage = (event) => {
      try {
        const msg: Message = JSON.parse(event.data);
        queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
          if (!prev) return [msg];
          // Dedup guard — don't append if already present
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch (e) {
        console.warn("[SSE] Failed to parse message event:", e);
      }
    };

    // Clear event: all messages were purged
    es.addEventListener("clear", () => {
      queryClient.setQueryData([api.messages.list.path], []);
      console.log("[SSE] Log cleared by server broadcast");
    });

    es.onerror = () => {
      // EventSource auto-reconnects natively — no manual retry needed
      console.warn("[SSE] Stream error — browser will reconnect automatically");
    };

    return () => {
      es.close();
      console.log("[SSE] Stream closed");
    };
  }, [queryClient]);
}
