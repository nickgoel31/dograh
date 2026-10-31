# Builds the new web app and serves the files. Built to live under /new/ on the main address (see docs/RUNBOOK.md).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE=/new/
ARG VITE_CLASSIC_URL=
ENV VITE_USE_MOCKS=false VITE_API_URL=/api/v1/product VITE_BASE=$VITE_BASE VITE_CLASSIC_URL=$VITE_CLASSIC_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
