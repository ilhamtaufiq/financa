# Image dasbor (Vite statis). Build di Node, hasilnya dilayani Nginx.
# VITE_* dibaca Vite saat BUILD, bukan saat runtime. Jadi diisi sebagai build argument di Coolify.

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG VITE_BACKEND_URL
ARG VITE_ANALITIK_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_ANALITIK_URL=$VITE_ANALITIK_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
