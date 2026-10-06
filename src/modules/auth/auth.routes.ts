import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { login, register } from './auth.service';
import { loginSchema, registerSchema } from './schemas';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register(input);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await login(input);
    res.status(200).json(result);
  }),
);
