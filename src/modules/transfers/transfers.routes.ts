import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AuthenticatedRequest, requireAuth } from '../../middleware/auth';
import { getAccountForOwner } from '../accounts/accounts.service';
import { createTransferSchema } from './schemas';
import { createTransfer } from './transfers.service';

export const transfersRouter = Router();

transfersRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).user!.id;
    const input = createTransferSchema.parse(req.body);
    const account = await getAccountForOwner(userId);
    const result = await createTransfer(account.id, input);
    res.status(201).json(result);
  }),
);
