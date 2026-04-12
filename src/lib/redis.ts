import Redis from 'ioredis';
import logger from './logger';

// URL Redis dari Google Memorystore
// Format: redis://host:port
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
});

redis.on('error', (err: Error) => {
  logger.error(`[Redis] Connection Error: ${err.message}`);
});

redis.on('connect', () => {
  logger.info('[Redis] Connected to Memorystore');
});

redis.on('reconnecting', () => {
  logger.warn('[Redis] Reconnecting to Memorystore...');
});

export default redis;
