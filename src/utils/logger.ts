export const log = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  bot1: (...args: any[]) => console.log('[Bot1]', ...args),
  bot2: (...args: any[]) => console.log('[Bot2]', ...args),
  worker: (userId: string, ...args: any[]) => console.log(`[Worker:${userId}]`, ...args),
};
