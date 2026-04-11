# Gunakan image Node.js yang ringan
FROM node:20-slim

# Tentukan direktori kerja
WORKDIR /app

# Copy package.json dan package-lock.json (untuk caching)
COPY package*.json ./

# Install dependensi (hanya production)
RUN npm install --omit=dev

# Copy semua kode sumber aplikasi
COPY . .

# Berikan hak akses (opsional tapi bagus untuk Cloud Run)
RUN chown -R node:node /app
USER node

# Expose port yang digunakan Cloud Run (default: 8080)
EXPOSE 8080

# Jalankan perintah start dari package.json
CMD [ "npm", "start" ]
