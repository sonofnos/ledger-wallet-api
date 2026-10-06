import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AuthenticatedRequest, requireAuth } from '../../middleware/auth';
import { getAccountForOwner } from '../accounts/accounts.service';
import { listTransactionsQuerySchema } from './schemas';
import { listTransactions } from './transactions.service';

export const transactionsRouter = Router();

transactionsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).user!.id;
    const query = listTransactionsQuerySchema.parse(req.query);
    const account = await getAccountForOwner(userId);
    const page = await listTransactions(account.id, query.limit, query.cursor);
    res.status(200).json(page);
  }),
);
