import request from 'supertest';
import express from 'express';
import authRouter from './auth';
import { users } from '../lib/db';

// Mocking dependencies
jest.mock('../lib/db', () => ({
  users: {
    findByEmail: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    public: jest.fn((u) => u),
  },
}));

jest.mock('../lib/auth', () => ({
  signToken: jest.fn(() => 'mocked_token'),
}));

jest.mock('../lib/email', () => ({
  sendVerificationEmail: jest.fn(() => Promise.resolve(true)),
  sendResetPasswordEmail: jest.fn(() => Promise.resolve(true)),
}));

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Auth Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should return 400 if validation fails (short password)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: '123', // Too short
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.errors[0].path).toBe('password');
    });

    it('should return 400 if email already exists', async () => {
      (users.findByEmail as jest.Mock).mockResolvedValue({ id: '1', email: 'test@example.com' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email already exists');
    });

    it('should register successfully with valid data', async () => {
      (users.findByEmail as jest.Mock).mockResolvedValue(null);
      (users.create as jest.Mock).mockResolvedValue({ id: 'new-id', username: 'testuser', email: 'test@example.com' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBe('mocked_token');
      expect(users.create).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 if email is invalid', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'not-an-email',
          password: 'any',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });
});
