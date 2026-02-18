# Build stage
FROM docker.io/node:lts-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/client-portal/package.json ./apps/client-portal/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY apps/client-portal/ ./apps/client-portal/
COPY tsconfig.base.json ./
COPY nx.json ./

# Build the application
RUN pnpm exec nx build @org/client-portal --configuration=production

# Production stage - using nginx to serve static files
FROM nginx:alpine

# Copy built application
COPY --from=builder /app/apps/client-portal/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/client-portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

