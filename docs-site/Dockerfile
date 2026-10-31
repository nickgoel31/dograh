# Builds the static docs site and serves it with nginx.
# Build from the repo root so the build can read the product code for fact checks:
#   docker build -f docs-site/Dockerfile -t swarvo-docs .
FROM node:20-alpine AS build
WORKDIR /repo
COPY api/product ./api/product
COPY docs ./docs
COPY docs-site ./docs-site
WORKDIR /repo/docs-site
RUN npm ci
# The generated pages and facts are committed, so the build only needs node.
RUN node scripts/gen-pages.mjs && npx astro build

FROM nginx:1.27-alpine
COPY docs-site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/docs-site/dist /usr/share/nginx/html
EXPOSE 80
