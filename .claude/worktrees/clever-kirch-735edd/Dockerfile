FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

# Instalar dependencias necesarias para Puppeteer en Alpine
RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/server.js"]
