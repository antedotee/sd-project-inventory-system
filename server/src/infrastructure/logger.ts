import pino, { type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'stockpilot' },
    redact: { paths: ['password', '*.password', 'req.headers.cookie'], remove: true },
  });
}
