import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AuthenticatedRequest, requireAuth } from '../../middleware/auth';
import { getAccountForOwner } from './accounts.service';

export const accountsRouter = Router();

accountsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).user!.id;
    const account = await getAccountForOwner(userId);
    res.status(200).json(account);
  }),
);
