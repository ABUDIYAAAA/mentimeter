FROM node:22-alpine

# Install LibreOffice, poppler-utils, and fonts for rendering PPTX files
RUN apk add --no-cache \
    libreoffice \
    poppler-utils \
    font-noto \
    font-noto-cjk \
    font-noto-emoji \
    font-noto-extra \
    bash

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./

RUN npm ci --omit=dev

# Copy application
COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]