# Docker Deployment Guide

## Overview

This guide covers deploying yt-dlp-mcp using Docker with multi-architecture support (amd64 and arm64).

## Quick Start

### Using Pre-built Images from GHCR

```bash
# Pull the latest image
docker pull ghcr.io/yachi/yt-dlp-mcp:latest

# Run with default configuration
docker run -d \
  --name yt-dlp-mcp \
  -p 3000:3000 \
  -v $(pwd)/downloads:/downloads \
  ghcr.io/yachi/yt-dlp-mcp:latest
```

### Using Docker Compose

1. Create a `docker-compose.yml` file (see repository root)
2. Create a `.env` file for configuration:

```bash
# Security
YTDLP_API_KEY=your-secret-api-key-here

# CORS (use specific origin in production)
YTDLP_CORS_ORIGIN=https://your-domain.com

# Rate limiting
YTDLP_RATE_LIMIT=60

# Session timeout (1 hour = 3600000ms)
YTDLP_SESSION_TIMEOUT=3600000

# Download preferences
YTDLP_DEFAULT_RESOLUTION=720p
YTDLP_DEFAULT_SUBTITLE_LANG=en
```

3. Start the service:

```bash
docker-compose up -d
```

4. Check health:

```bash
curl http://localhost:3000/health
```

## Building Locally

### Build for Current Architecture

```bash
docker build -t yt-dlp-mcp:local .
```

### Build Multi-Architecture Image

```bash
# Create and use a new builder
docker buildx create --name mybuilder --use

# Build for multiple platforms
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t yt-dlp-mcp:multi-arch \
  --load \
  .
```

## Image Details

### Multi-Architecture Support

The Docker images are built for multiple architectures:

- **linux/amd64** - Intel/AMD 64-bit (x86_64)
- **linux/arm64** - ARM 64-bit (aarch64)

Docker automatically pulls the correct architecture for your system.

### Image Size

- **Compressed**: ~150 MB
- **Uncompressed**: ~450 MB

Based on `node:20-alpine` for minimal footprint.

### Included Components

- Node.js 20 (Alpine)
- yt-dlp (latest)
- ffmpeg (for media processing)
- Python 3 (for yt-dlp)

## Configuration

### Environment Variables

All server configuration can be set via environment variables:

#### Server Settings

```bash
YTDLP_HTTP_PORT=3000          # Server port (default: 3000)
YTDLP_HTTP_HOST=0.0.0.0       # Server host (default: 0.0.0.0)
```

#### Security

```bash
YTDLP_API_KEY=secret          # API key for authentication
YTDLP_CORS_ORIGIN=*           # CORS allowed origin
YTDLP_RATE_LIMIT=60           # Requests per minute per session
YTDLP_SESSION_TIMEOUT=3600000 # Session timeout in milliseconds
```

#### Downloads

```bash
YTDLP_DOWNLOADS_DIR=/downloads          # Download directory
YTDLP_DEFAULT_RESOLUTION=720p           # Default video resolution
YTDLP_DEFAULT_SUBTITLE_LANG=en         # Default subtitle language
```

### Volumes

Mount a volume for persistent downloads:

```bash
docker run -d \
  -v /path/on/host:/downloads \
  ghcr.io/yachi/yt-dlp-mcp:latest
```

### Port Mapping

Map container port to host:

```bash
# Default port 3000
docker run -d -p 3000:3000 ghcr.io/yachi/yt-dlp-mcp:latest

# Custom port
docker run -d -p 8080:3000 ghcr.io/yachi/yt-dlp-mcp:latest
```

## Production Deployment

### With HTTPS (nginx reverse proxy)

1. Create `nginx.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name yt-dlp.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://yt-dlp-mcp:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For SSE streaming
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

2. Update `docker-compose.yml` to include nginx

3. Start services:

```bash
docker-compose up -d
```

### Resource Limits

Set resource limits for production:

```yaml
services:
  yt-dlp-mcp:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### Logging

Configure logging driver:

```yaml
services:
  yt-dlp-mcp:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Health Checks

The Docker image includes a health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', ...)"
```

Check container health:

```bash
docker ps
# Look for "healthy" status

# Or inspect directly
docker inspect --format='{{.State.Health.Status}}' yt-dlp-mcp
```

## Kubernetes Deployment

### Basic Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: yt-dlp-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: yt-dlp-mcp
  template:
    metadata:
      labels:
        app: yt-dlp-mcp
    spec:
      containers:
      - name: yt-dlp-mcp
        image: ghcr.io/yachi/yt-dlp-mcp:latest
        ports:
        - containerPort: 3000
        env:
        - name: YTDLP_API_KEY
          valueFrom:
            secretKeyRef:
              name: yt-dlp-secrets
              key: api-key
        - name: YTDLP_CORS_ORIGIN
          value: "https://your-domain.com"
        volumeMounts:
        - name: downloads
          mountPath: /downloads
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
      volumes:
      - name: downloads
        persistentVolumeClaim:
          claimName: yt-dlp-downloads
---
apiVersion: v1
kind: Service
metadata:
  name: yt-dlp-mcp
spec:
  selector:
    app: yt-dlp-mcp
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs yt-dlp-mcp
```

Common issues:
- yt-dlp not available: Image should include it automatically
- Permission errors: Check volume mount permissions
- Port already in use: Change host port mapping

### Health check failing

Verify the server is responding:
```bash
docker exec yt-dlp-mcp wget -qO- http://localhost:3000/health
```

### Downloads not persisting

Ensure volume is mounted correctly:
```bash
docker inspect yt-dlp-mcp | grep -A 10 Mounts
```

## Security Best Practices

1. **Always set an API key in production**:
   ```bash
   YTDLP_API_KEY=$(openssl rand -hex 32)
   ```

2. **Use specific CORS origin**:
   ```bash
   YTDLP_CORS_ORIGIN=https://your-domain.com
   ```

3. **Run behind HTTPS proxy** (nginx, Caddy, Traefik)

4. **Use secrets management**:
   - Docker secrets
   - Kubernetes secrets
   - HashiCorp Vault

5. **Limit resource usage** with Docker resource constraints

6. **Regular updates**:
   ```bash
   docker pull ghcr.io/yachi/yt-dlp-mcp:latest
   docker-compose up -d
   ```

## Monitoring

### Prometheus Metrics (Future Enhancement)

The image is designed to support future Prometheus integration.

### Log Aggregation

Send logs to centralized logging:

```yaml
logging:
  driver: "fluentd"
  options:
    fluentd-address: "localhost:24224"
    tag: "yt-dlp-mcp"
```

## CI/CD Integration

### GitHub Actions

The repository includes a multi-arch build workflow (`.github/workflows/docker-multi-arch.yml`):

- Builds for amd64 and arm64 on native runners
- Pushes to GHCR automatically on main branch
- Tags with semantic versioning

### Pulling Images

```bash
# Latest
ghcr.io/yachi/yt-dlp-mcp:latest

# Specific version
ghcr.io/yachi/yt-dlp-mcp:v0.7.0

# By commit SHA
ghcr.io/yachi/yt-dlp-mcp:sha-abc1234
```

## Support

For issues with Docker deployment:
- Check [GitHub Issues](https://github.com/yachi/yt-dlp-mcp/issues)
- Review container logs: `docker logs yt-dlp-mcp`
- Verify health: `curl http://localhost:3000/health`
