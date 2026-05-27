import pino from 'pino';
import { setLogger } from './logger';

export function createPinoLogger(level: string = 'info'): void {
  const p = pino({
    level,
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });

  setLogger({
    info(msg, ctx) { p.info(ctx ?? {}, msg); },
    warn(msg, ctx) { p.warn(ctx ?? {}, msg); },
    error(msg, err, ctx) { p.error({ err, ...(ctx ?? {}) }, msg); },
  });
}
