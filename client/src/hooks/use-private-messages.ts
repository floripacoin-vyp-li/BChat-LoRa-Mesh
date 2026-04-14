import { useRef, useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { Message } from "@shared/schema";
import { parseDmPayload } from "@/lib/crypto";
import type { useContacts } from "@/hooks/use-contacts";

export interface PrivateMessage {
  id: number;
  senderAlias: string;
  content: string;
  timestamp: Date;
  mine: boolean;
}

type ContactsHook = ReturnType<typeof useContacts>;

export function usePrivateMessages(
  contacts: ContactsHook["contacts"],
  getSharedKey: ContactsHook["getSharedKey"]
) {
  const queryClient = useQueryClient();
  // decryptedIds: messages that were successfully decrypted (or confirmed non-DM) — permanently skip
  const decryptedIds = useRef<Set<number>>(new Set());
  // inProgressIds: DMs whose IIFE is currently running — prevents duplicate concurrent work
  const inProgressIds = useRef<Set<number>>(new Set());
  const threads = useRef<Map<string, PrivateMessage[]>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [, forceRender] = useState(0);

  useEffect(() => {
    function processMessages() {
      const messages = queryClient.getQueryData<Message[]>([api.messages.list.path]);
      if (!messages) return;

      for (const msg of messages) {
        // Already successfully handled, or a concurrent IIFE is running for this id
        if (decryptedIds.current.has(msg.id) || inProgressIds.current.has(msg.id)) continue;

        const parsed = parseDmPayload(msg.content);
        if (!parsed) {
          // Not a DM — permanently skip without async work
          decryptedIds.current.add(msg.id);
          continue;
        }

        // Guard against concurrent IIFEs for the same message
        inProgressIds.current.add(msg.id);

        (async () => {
          let added = false;
          try {
            for (const contact of contacts) {
              const sharedKey = await getSharedKey(contact.alias);
              if (!sharedKey) continue;

              const { decrypt } = await import("@/lib/crypto");
              const plaintext = await decrypt(sharedKey, parsed.encrypted);
              if (plaintext === null) continue;

              const mine = parsed.senderAlias !== contact.alias;
              const threadAlias = contact.alias;

              const privateMsg: PrivateMessage = {
                id: msg.id,
                senderAlias: parsed.senderAlias,
                content: plaintext,
                timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
                mine,
              };

              const existing = threads.current.get(threadAlias) ?? [];
              if (existing.some((m) => m.id === privateMsg.id)) {
                // Already in the thread (shouldn't happen due to inProgressIds guard)
              } else if (mine && existing.some((m) => m.mine && m.content === privateMsg.content)) {
                // Replace the optimistic copy (id: Date.now()) with the real server message
                threads.current.set(
                  threadAlias,
                  existing.map((m) =>
                    m.mine && m.content === privateMsg.content && m.id > 1_000_000_000_000
                      ? privateMsg
                      : m
                  )
                );
                added = true;
              } else {
                threads.current.set(threadAlias, [...existing, privateMsg]);
                if (!mine) {
                  setUnreadCounts((prev) => ({
                    ...prev,
                    [threadAlias]: (prev[threadAlias] ?? 0) + 1,
                  }));
                }
                added = true;
              }

              // Only permanently skip after a successful decrypt
              decryptedIds.current.add(msg.id);
              break;
            }
          } finally {
            // Always clear the in-progress guard.
            // If decryption failed (no matching contact / key), the message is NOT in
            // decryptedIds, so it will be retried on the next processMessages() call —
            // which fires immediately when contacts change (see below).
            inProgressIds.current.delete(msg.id);
          }

          if (added) forceRender((n) => n + 1);
        })();
      }
    }

    // Re-scan immediately whenever contacts change so that DMs received before a contact
    // was added (and therefore failed to decrypt earlier) are processed right away.
    processMessages();

    const unsubscribe = queryClient.getQueryCache().subscribe(processMessages);
    return () => unsubscribe();
  }, [queryClient, contacts, getSharedKey]);

  const getThread = useCallback((contactAlias: string): PrivateMessage[] => {
    return threads.current.get(contactAlias) ?? [];
  }, []);

  const addSentDm = useCallback((contactAlias: string, content: string) => {
    const msg: PrivateMessage = {
      id: Date.now(),
      senderAlias: "me",
      content,
      timestamp: new Date(),
      mine: true,
    };
    const existing = threads.current.get(contactAlias) ?? [];
    threads.current.set(contactAlias, [...existing, msg]);
    forceRender((n) => n + 1);
  }, []);

  const markRead = useCallback((contactAlias: string) => {
    setUnreadCounts((prev) => {
      if ((prev[contactAlias] ?? 0) === 0) return prev; // bail out if already zero
      return { ...prev, [contactAlias]: 0 };
    });
  }, []);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return { getThread, addSentDm, markRead, unreadCounts, totalUnread };
}
