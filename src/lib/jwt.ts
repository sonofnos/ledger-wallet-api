import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthTokenPayload {
  sub: string; // user id
  email: string;
}

export function signToken(payload: AuthTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwt.secret, options);
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, config.jwt.secret) as AuthTokenPayload;
}
