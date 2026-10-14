# Image web (Astro statis). Build di Node, hasilnya dilayani Nginx.
# PUBLIC_API_URL dan PUBLIC_SITE_URL dibaca Astro saat BUILD, bukan saat runtime. Jadi diisi sebagai build argument di Coolify.

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG PUBLIC_API_URL
ARG PUBLIC_SITE_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
