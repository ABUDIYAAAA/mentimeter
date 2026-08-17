FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./

RUN npm ci --omit=dev

# Copy application
COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]