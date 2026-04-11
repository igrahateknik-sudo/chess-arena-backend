'use strict';

const Redis = require('ioredis');

// Initialize Redis Client
const redisClient = new Redis({
  host: 'localhost', // Redis host
  port: 6379,       // Redis port
  password: 'your_password', // Redis password, if applicable
  db: 0             // Database number
});

module.exports = redisClient;