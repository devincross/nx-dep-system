# Build stage
FROM docker.io/node:lts-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/landlord-admin/package.json ./apps/landlord-admin/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY apps/landlord-admin/ ./apps/landlord-admin/
COPY tsconfig.base.json ./
COPY nx.json ./

# Set API URL for production build (relative URL since nginx proxies /api)
ENV VITE_API_URL=/api

# Build the application
RUN pnpm exec nx build @org/landlord-admin --configuration=production

# Production stage - using nginx to serve static files
FROM nginx:alpine

# Copy built application
COPY --from=builder /app/apps/landlord-admin/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/landlord-admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

