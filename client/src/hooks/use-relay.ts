import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { buildTextToRadio } from "@/lib/meshtastic";
import type { Message } from "@shared/schema";

const RELAY_INTERVAL_MS = 2000;

export function useRelay(isConnected: boolean) {
  const queryClient = useQueryClient();
  const lastSeenIdRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isConnected) {
      initializedRef.current = false;
      return;
    }

    // On first connection, set the high-water mark to the current max message ID
    // so we don't re-transmit messages that existed before the operator connected.
    if (!initializedRef.current) {
      const cached = queryClient.getQueryData<Message[]>([api.messages.list.path]);
      if (cached && cached.length > 0) {
        lastSeenIdRef.current = Math.max(...cached.map((m) => m.id));
      }
      initializedRef.current = true;
      console.log("Relay: initialized, high-water mark id =", lastSeenIdRef.current);
    }

    const interval = setInterval(async () => {
      if (!(window as any).meshtasticSend) return;

      try {
        const res = await fetch(
          `${api.messages.pending.path}?after=${lastSeenIdRef.current}`,
          { credentials: "include" }
        );
        if (!res.ok) return;

        const pending: Message[] = await res.json();
        if (pending.length === 0) return;

        let anyTransmitted = false;

        for (const msg of pending) {
          try {
            const bytes = buildTextToRadio(msg.content);
            await (window as any).meshtasticSend(bytes);

            await fetch(`/api/messages/${msg.id}/transmitted`, {
              method: "PATCH",
              credentials: "include",
            });

            if (msg.id > lastSeenIdRef.current) {
              lastSeenIdRef.current = msg.id;
            }

            anyTransmitted = true;
            console.log(`Relay: transmitted message ${msg.id} from ${msg.sender}`);
          } catch (err) {
            console.error(`Relay: failed to transmit message ${msg.id}:`, err);
          }
        }

        if (anyTransmitted) {
          queryClient.invalidateQueries({ queryKey: [api.messages.list.path] });
        }
      } catch (err) {
        console.error("Relay: poll error:", err);
      }
    }, RELAY_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      console.log("Relay: stopped");
    };
  }, [isConnected, queryClient]);
}
