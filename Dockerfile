# --- STAGE 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Copy configuration files
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Install dependencies (termasuk devDependencies untuk tsc)
RUN npm install

# Copy source code
COPY src ./src/

# Generate Prisma Client & Build TypeScript
RUN npx prisma generate
RUN npm run build

# --- STAGE 2: Production ---
FROM node:20-slim

WORKDIR /app

# Install Stockfish
RUN apt-get update && apt-get install -y stockfish && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY prisma ./prisma/

# Create logs directory
RUN mkdir logs && chown -R node:node /app

USER node

EXPOSE 8080

# Environment variable default (akan di-override oleh Cloud Run)
ENV NODE_ENV=production

CMD [ "npm", "start" ]
