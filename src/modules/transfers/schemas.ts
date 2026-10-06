import { z } from 'zod';

export const createTransferSchema = z.object({
  toAccountNumber: z.string().min(1),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(255),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
