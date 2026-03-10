import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { buildTextToRadio } from "@/lib/meshtastic";
import type { Message } from "@shared/schema";

const RELAY_INTERVAL_MS = 2000;

// Stable operator ID for this browser session — used for atomic claiming.
// Stored in sessionStorage so it survives React re-renders but resets on tab close.
function getOperatorId(): string {
  const key = "bcb-operator-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `op-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

const OPERATOR_ID = getOperatorId();

export function useRelay(isConnected: boolean) {
  const queryClient = useQueryClient();
  const lastSeenIdRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);

  // Operator heartbeat — tells the server this client has a live radio
  useEffect(() => {
    if (!isConnected) {
      // Notify server immediately that this operator is gone
      fetch("/api/operator/heartbeat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: OPERATOR_ID }),
        credentials: "include",
      }).catch(() => {});
      return;
    }

    const sendHeartbeat = () => {
      fetch("/api/operator/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: OPERATOR_ID }),
        credentials: "include",
      }).catch(() => {});
    };

    sendHeartbeat(); // immediate on connect
    const heartbeat = setInterval(sendHeartbeat, 10_000);
    return () => {
      clearInterval(heartbeat);
      // Best-effort offline notification on unmount
      fetch("/api/operator/heartbeat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId: OPERATOR_ID }),
        credentials: "include",
      }).catch(() => {});
    };
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) {
      initializedRef.current = false;
      return;
    }

    // On first connection, set the high-water mark to the current max message ID
    // so we don't attempt to relay messages that existed before the operator connected.
    if (!initializedRef.current) {
      const cached = queryClient.getQueryData<Message[]>([api.messages.list.path]);
      if (cached && cached.length > 0) {
        lastSeenIdRef.current = Math.max(...cached.map((m) => m.id));
      }
      initializedRef.current = true;
      console.log(`Relay: initialized as ${OPERATOR_ID}, high-water mark id = ${lastSeenIdRef.current}`);
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
          // Update high-water mark even for messages we don't win the claim on,
          // so we don't keep re-fetching already-handled messages.
          if (msg.id > lastSeenIdRef.current) {
            lastSeenIdRef.current = msg.id;
          }

          try {
            // Atomically claim this message — only one operator will succeed.
            const claimRes = await fetch(`/api/messages/${msg.id}/claim`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operatorId: OPERATOR_ID }),
              credentials: "include",
            });

            if (claimRes.status === 409) {
              console.log(`Relay: message ${msg.id} already claimed by another operator — skipping`);
              continue;
            }

            if (!claimRes.ok) {
              console.warn(`Relay: claim request failed for message ${msg.id}`);
              continue;
            }

            // We won the claim — transmit over radio.
            const bytes = buildTextToRadio(msg.content);
            await (window as any).meshtasticSend(bytes);

            await fetch(`/api/messages/${msg.id}/transmitted`, {
              method: "PATCH",
              credentials: "include",
            });

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
