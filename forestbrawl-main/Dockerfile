# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY artifacts/api-server/package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY artifacts/api-server/src ./src
COPY artifacts/api-server/build.mjs ./
COPY artifacts/api-server/tsconfig.json ./

# Build the application
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Copy built application and dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Copy static files
COPY artifacts/forestbrawl ./artifacts/forestbrawl

# Create data directory for persistent storage
RUN mkdir -p /var/data
ENV FB_DATA_DIR=/var/data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/healthz', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)}).on('error', (e) => {throw e})"

# Expose port
EXPOSE 8080

# Start application
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
