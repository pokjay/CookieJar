FROM node:22-slim

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# PUPPETEER_SKIP_DOWNLOAD is the puppeteer >= 20 name (needed since
# israeli-bank-scrapers v6 pulls puppeteer 24); the old
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is kept for older transitive installs.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN adduser --disabled-password --gecos '' --uid 1001 scraper

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN chown -R scraper:scraper /app

USER scraper

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
