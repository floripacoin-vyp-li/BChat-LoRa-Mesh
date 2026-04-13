import { useMemo, useState } from "react";
import type { Message } from "@shared/schema";
import { parseContactRequest, type ContactRequest } from "@/lib/crypto";

export interface PendingContactRequest extends ContactRequest {
  messageId: number;
}

export function useContactRequests(
  messages: Message[] | undefined,
  myAlias: string | null,
  contacts: { alias: string }[],
) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const pending = useMemo<PendingContactRequest[]>(() => {
    if (!messages || !myAlias) return [];
    const seen = new Set<string>();
    const requests: PendingContactRequest[] = [];

    for (const msg of messages) {
      const parsed = parseContactRequest(msg.content);
      if (!parsed) continue;
      if (parsed.toAlias !== myAlias) continue;
      if (dismissed.has(msg.id)) continue;
      if (contacts.some((c) => c.alias === parsed.fromAlias)) continue;
      if (seen.has(parsed.fromAlias)) continue;
      seen.add(parsed.fromAlias);
      requests.push({ ...parsed, messageId: msg.id });
    }
    return requests;
  }, [messages, myAlias, dismissed, contacts]);

  const dismiss = (messageId: number) => {
    setDismissed((prev) => new Set([...prev, messageId]));
  };

  return { pending, dismiss };
}
