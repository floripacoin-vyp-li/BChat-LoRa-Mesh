import { useRef, useState, useEffect } from "react";
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
  const seenIds = useRef<Set<number>>(new Set());
  const threads = useRef<Map<string, PrivateMessage[]>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [, forceRender] = useState(0);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const messages = queryClient.getQueryData<Message[]>([api.messages.list.path]);
      if (!messages) return;

      let changed = false;

      for (const msg of messages) {
        if (seenIds.current.has(msg.id)) continue;
        seenIds.current.add(msg.id);

        const parsed = parseDmPayload(msg.content);
        if (!parsed) continue;

        // Try each contact's shared key until one decrypts successfully
        (async () => {
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
            if (!existing.some((m) => m.id === privateMsg.id)) {
              threads.current.set(threadAlias, [...existing, privateMsg]);
              if (!mine) {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [threadAlias]: (prev[threadAlias] ?? 0) + 1,
                }));
              }
              changed = true;
            }
            break;
          }

          if (changed) forceRender((n) => n + 1);
        })();
      }
    });

    return () => unsubscribe();
  }, [queryClient, contacts, getSharedKey]);

  const getThread = (contactAlias: string): PrivateMessage[] => {
    return threads.current.get(contactAlias) ?? [];
  };

  const addSentDm = (contactAlias: string, content: string) => {
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
  };

  const markRead = (contactAlias: string) => {
    setUnreadCounts((prev) => ({ ...prev, [contactAlias]: 0 }));
  };

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return { getThread, addSentDm, markRead, unreadCounts, totalUnread };
}
