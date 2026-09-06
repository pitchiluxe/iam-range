/**
 * util/log.ts — structured logger with log levels.
 * Routes to console.log / console.warn / console.error.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(l: LogLevel) {
  currentLevel = l;
}

function log(level: LogLevel, prefix: string, ...args: unknown[]) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[${level.toUpperCase()}] [${prefix}]`, ...args);
}

export const logger = {
  debug: (p: string, ...a: unknown[]) => log('debug', p, ...a),
  info: (p: string, ...a: unknown[]) => log('info', p, ...a),
  warn: (p: string, ...a: unknown[]) => log('warn', p, ...a),
  error: (p: string, ...a: unknown[]) => log('error', p, ...a),
};
