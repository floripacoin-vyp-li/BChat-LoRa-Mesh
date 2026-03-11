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

    // Default event: a new message was created (online path)
    es.onmessage = (event) => {
      try {
        const msg: Message = JSON.parse(event.data);
        queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
          if (!prev) return [msg];
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

    // message-deleted event: one message was deleted by its owner
    es.addEventListener("message-deleted", (event) => {
      try {
        const { id } = JSON.parse((event as MessageEvent).data);
        queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) =>
          prev ? prev.filter((m) => m.id !== id) : []
        );
      } catch (_) {}
    });

    // Operator presence event — a gateway came online or went offline
    es.addEventListener("operator-status", (event) => {
      try {
        const { count } = JSON.parse(event.data);
        window.dispatchEvent(new CustomEvent("gateway-status", { detail: { count } }));
      } catch (_) {}
    });

    es.onerror = () => {
      console.warn("[SSE] Stream error — browser will reconnect automatically");
    };

    // Local-message event: offline path — incoming LoRa packets injected directly
    const handleLocalMessage = (event: Event) => {
      const msg = (event as CustomEvent).detail as Message;
      if (!msg) return;
      console.log("[Local] Injecting offline message into cache:", msg.content);
      queryClient.setQueryData<Message[]>([api.messages.list.path], (prev) => {
        if (!prev) return [msg];
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    window.addEventListener("local-message", handleLocalMessage);

    return () => {
      es.close();
      window.removeEventListener("local-message", handleLocalMessage);
      console.log("[SSE] Stream closed");
    };
  }, [queryClient]);
}
