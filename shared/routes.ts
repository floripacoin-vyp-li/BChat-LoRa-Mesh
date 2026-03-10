import { z } from 'zod';
import { insertMessageSchema, messages } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  messages: {
    list: {
      method: 'GET' as const,
      path: '/api/messages' as const,
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/messages' as const,
      input: insertMessageSchema,
      responses: {
        201: z.custom<typeof messages.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    clear: {
      method: 'DELETE' as const,
      path: '/api/messages' as const,
      responses: {
        204: z.void(),
      },
    },
    pending: {
      method: 'GET' as const,
      path: '/api/messages/pending' as const,
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      },
    },
    markTransmitted: {
      method: 'PATCH' as const,
      path: '/api/messages/:id/transmitted' as const,
      responses: {
        200: z.custom<typeof messages.$inferSelect>(),
        404: errorSchemas.internal,
      },
    },
    stream: {
      method: 'GET' as const,
      path: '/api/messages/stream' as const,
    },
    claim: {
      method: 'POST' as const,
      path: '/api/messages/:id/claim' as const,
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type MessageInput = z.infer<typeof api.messages.create.input>;
export type MessageResponse = z.infer<typeof api.messages.create.responses[201]>;
export type MessagesListResponse = z.infer<typeof api.messages.list.responses[200]>;
