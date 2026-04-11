// lib/validators.js

import { z } from 'zod';

// Example Zod validation schema
const createUserSchema = z.object({
    username: z.string().min(3).max(30),
    email: z.string().email(),
    password: z.string().min(8),
});

const updateUserSchema = z.object({
    username: z.string().min(3).max(30).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
});

export { createUserSchema, updateUserSchema };