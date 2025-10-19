# Multi-stage Dockerfile for yt-dlp-mcp HTTP server
# Optimized for multi-arch builds (amd64, arm64)

FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (skip prepare script since source isn't copied yet)
RUN npm ci --ignore-scripts

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run prepare

# Production stage
FROM node:20-alpine

# Install yt-dlp and runtime dependencies
RUN apk add --no-cache \
    yt-dlp \
    ffmpeg \
    python3 \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S ytdlp && \
    adduser -u 1001 -S ytdlp -G ytdlp

WORKDIR /app

# Copy package files for production dependencies
COPY --chown=ytdlp:ytdlp package*.json ./

# Install production dependencies only (ignore scripts since we're copying pre-built files)
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy built application from builder
COPY --chown=ytdlp:ytdlp --from=builder /app/lib ./lib

# Copy README for reference
COPY --chown=ytdlp:ytdlp README.md ./

# Create downloads directory
RUN mkdir -p /downloads && \
    chown -R ytdlp:ytdlp /downloads

# Switch to non-root user
USER ytdlp

# Environment variables
ENV NODE_ENV=production \
    YTDLP_DOWNLOADS_DIR=/downloads \
    YTDLP_HTTP_PORT=3000 \
    YTDLP_HTTP_HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Volume for downloads
VOLUME ["/downloads"]

# Default command - run HTTP server
CMD ["node", "lib/server-http.mjs"]

# Labels
LABEL org.opencontainers.image.title="yt-dlp-mcp"
LABEL org.opencontainers.image.description="MCP server for yt-dlp with HTTP transport"
LABEL org.opencontainers.image.vendor="kevinwatt"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/kevinwatt/yt-dlp-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/kevinwatt/yt-dlp-mcp#readme"
