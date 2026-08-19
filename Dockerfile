FROM node:22-slim

# Install LibreOffice, poppler-utils, and fonts for rendering PPTX files
# Using Debian base for full OOXML (.pptx) filter support (Alpine LibreOffice lacks oox filter)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    libreoffice-writer \
    libreoffice-calc \
    poppler-utils \
    fonts-noto \
    fonts-noto-cjk \
    unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./

RUN npm ci --omit=dev

# Copy application
COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]