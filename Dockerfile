# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /app

ARG VITE_PLANNER_API_BASE_URL
ENV VITE_PLANNER_API_BASE_URL=${VITE_PLANNER_API_BASE_URL}

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS backend-build
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ASSETS_DIR=/app/public
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/dist ./public

EXPOSE 8080
CMD ["node", "dist/index.js"]
