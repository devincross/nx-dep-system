# Build stage
FROM docker.io/node:lts-alpine AS builder

WORKDIR /app

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml ./
COPY apps/client-api/package.json ./apps/client-api/
COPY libs/database/package.json ./libs/database/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy all source code needed for build
COPY apps/client-api/ ./apps/client-api/
COPY libs/database/ ./libs/database/
COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY nx.json ./
COPY eslint.config.mjs ./
COPY pnpm-workspace.yaml ./

# Build the database library first (dependency)
RUN cd libs/database && pnpm exec tsc --build

# Build the application
RUN pnpm exec nx build @org/client-api --configuration=production

# Remove @org/* packages from dependencies (they're bundled)
RUN cd apps/client-api/dist && \
    node -e "const p=require('./package.json'); \
    p.dependencies=Object.fromEntries(Object.entries(p.dependencies||{}).filter(([k])=>!k.startsWith('@org/'))); \
    require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2));"

# Production stage
FROM docker.io/node:lts-alpine

ENV HOST=0.0.0.0
ENV PORT=3001
ENV NODE_ENV=production

WORKDIR /app

# Copy built application and cleaned package.json
COPY --from=builder /app/apps/client-api/dist ./

# Install production dependencies
RUN npm install --omit=dev --ignore-scripts

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

USER nestjs

EXPOSE 3001

CMD ["node", "main.js"]

