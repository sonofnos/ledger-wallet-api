import cors from 'cors';
import express, { Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { accountsRouter } from './modules/accounts/accounts.routes';
import { authRouter } from './modules/auth/auth.routes';
import { transactionsRouter } from './modules/transactions/transactions.routes';
import { transfersRouter } from './modules/transfers/transfers.routes';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();

  // No origin restriction: this API has no browser client, only the React
  // Native app, whose fetch requests never send an Origin header. The cors
  // default (`origin: true`-like reflect) is for browsers; here we just
  // need requests with no Origin header to pass straight through, which
  // Express does already. We still mount cors() so a future web client (or
  // a browser-based API explorer) is not blocked by default.
  app.use(cors());
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/accounts', accountsRouter);
  app.use('/transactions', transactionsRouter);
  app.use('/transfers', transfersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
