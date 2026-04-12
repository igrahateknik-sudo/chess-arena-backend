# --- STAGE 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and config
COPY . .

# Build Next.js app
# Pastikan NEXT_PUBLIC variables di-set saat build jika menggunakan output: 'standalone'
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- STAGE 2: Runner ---
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Salin file yang diperlukan untuk menjalankan Next.js standalone
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
