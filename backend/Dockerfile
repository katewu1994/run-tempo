FROM node:22-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim

ENV NODE_ENV=production
ENV PATH="/opt/yt-dlp/bin:${PATH}"
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --pre "yt-dlp[default]" \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
