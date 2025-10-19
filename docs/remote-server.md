# Remote HTTP Server for yt-dlp-mcp

## Overview

The yt-dlp-mcp HTTP server provides remote access to all yt-dlp MCP tools using the official **Streamable HTTP** transport protocol from the Model Context Protocol specification.

This allows you to:
- Deploy yt-dlp-mcp on a server and access it from multiple clients
- Use yt-dlp tools from Claude Desktop, Cline, or other MCP clients over HTTP
- Share a single yt-dlp installation across a team or organization
- Run downloads on a dedicated machine with better bandwidth/storage

## Quick Start

### Installation

```bash
npm install -g @kevinwatt/yt-dlp-mcp
```

### Start the Server

```bash
# Start with defaults (port 3000, host 0.0.0.0)
yt-dlp-mcp-http

# Or with custom configuration
YTDLP_HTTP_PORT=8080 YTDLP_API_KEY=your-secret-key yt-dlp-mcp-http
```

The server will start and display:
```
╔════════════════════════════════════════════════╗
║  🎬 yt-dlp-mcp HTTP Server                    ║
╟────────────────────────────────────────────────╢
║  Version:   0.7.0                              ║
║  Protocol:  Streamable HTTP (MCP Spec)         ║
║  Endpoint:  http://0.0.0.0:3000/mcp            ║
║  Health:    http://0.0.0.0:3000/health         ║
╟────────────────────────────────────────────────╢
║  Security:                                     ║
║    • API Key:       ✓ Enabled                  ║
║    • CORS:          *                          ║
║    • Rate Limit:    60/min per session         ║
║    • Session Timeout: 60 minutes               ║
╚════════════════════════════════════════════════╝
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YTDLP_HTTP_PORT` | `3000` | Server port |
| `YTDLP_HTTP_HOST` | `0.0.0.0` | Server host (use `0.0.0.0` for all interfaces) |
| `YTDLP_API_KEY` | (none) | API key for authentication (highly recommended) |
| `YTDLP_CORS_ORIGIN` | `*` | CORS allowed origin (use specific origin in production) |
| `YTDLP_RATE_LIMIT` | `60` | Max requests per minute per session |
| `YTDLP_SESSION_TIMEOUT` | `3600000` | Session timeout in milliseconds (1 hour) |

Plus all standard yt-dlp-mcp environment variables:
- `YTDLP_DOWNLOADS_DIR`
- `YTDLP_DEFAULT_RESOLUTION`
- `YTDLP_DEFAULT_SUBTITLE_LANG`
- etc.

### Production Configuration Example

```bash
# Create a .env file
cat > .env <<EOF
YTDLP_HTTP_PORT=3000
YTDLP_HTTP_HOST=0.0.0.0
YTDLP_API_KEY=$(openssl rand -hex 32)
YTDLP_CORS_ORIGIN=https://your-client.com
YTDLP_RATE_LIMIT=30
YTDLP_SESSION_TIMEOUT=1800000
YTDLP_DOWNLOADS_DIR=/mnt/downloads
EOF

# Load and start
export $(cat .env | xargs)
yt-dlp-mcp-http
```

## Client Configuration

### Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "yt-dlp-remote": {
      "transport": "http",
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key-here"
      }
    }
  }
}
```

### Cline (VS Code Extension)

```json
{
  "mcpServers": {
    "yt-dlp": {
      "type": "http",
      "endpoint": "http://your-server:3000/mcp",
      "apiKey": "your-api-key-here"
    }
  }
}
```

## Security

### 🔒 Authentication

**Always set an API key for production deployments:**

```bash
# Generate a secure API key
export YTDLP_API_KEY=$(openssl rand -hex 32)
echo "Your API key: $YTDLP_API_KEY"
```

Clients must include the API key in the `Authorization` header:
```
Authorization: Bearer your-api-key-here
```

### 🛡️ CORS Configuration

By default, CORS allows all origins (`*`). **Change this in production:**

```bash
# Allow only specific origin
export YTDLP_CORS_ORIGIN=https://your-app.com

# Allow multiple origins (comma-separated)
export YTDLP_CORS_ORIGIN=https://app1.com,https://app2.com
```

### ⏱️ Rate Limiting

The server implements per-session rate limiting:
- Default: 60 requests per minute per session
- Resets every 60 seconds
- Returns HTTP 429 when exceeded

### 🔐 Network Security Recommendations

1. **Use HTTPS in production** - Put the server behind a reverse proxy (nginx, Caddy)
2. **Restrict host binding** - Use `127.0.0.1` if only local access is needed
3. **Firewall rules** - Only allow traffic from trusted IPs
4. **VPN/Private network** - Keep server on private network if possible

## Deployment

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

# Install yt-dlp
RUN apk add --no-cache yt-dlp

# Install server
RUN npm install -g @kevinwatt/yt-dlp-mcp

# Create downloads directory
RUN mkdir -p /downloads
ENV YTDLP_DOWNLOADS_DIR=/downloads

# Expose port
EXPOSE 3000

CMD ["yt-dlp-mcp-http"]
```

Run:
```bash
docker build -t yt-dlp-mcp-http .
docker run -d \
  -p 3000:3000 \
  -e YTDLP_API_KEY=your-secret-key \
  -e YTDLP_CORS_ORIGIN=https://your-app.com \
  -v /path/to/downloads:/downloads \
  yt-dlp-mcp-http
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name yt-dlp.your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # For streaming responses
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

### systemd Service

Create `/etc/systemd/system/yt-dlp-mcp-http.service`:

```ini
[Unit]
Description=yt-dlp MCP HTTP Server
After=network.target

[Service]
Type=simple
User=ytdlp
WorkingDirectory=/opt/yt-dlp-mcp
Environment="YTDLP_HTTP_PORT=3000"
Environment="YTDLP_API_KEY=your-secret-key"
Environment="YTDLP_DOWNLOADS_DIR=/mnt/downloads"
ExecStart=/usr/bin/yt-dlp-mcp-http
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable yt-dlp-mcp-http
sudo systemctl start yt-dlp-mcp-http
sudo systemctl status yt-dlp-mcp-http
```

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "ok",
  "version": "0.7.0",
  "sessions": 3
}
```

### MCP Protocol Endpoint
```
POST /mcp
GET /mcp?sessionId=xxx
DELETE /mcp?sessionId=xxx
```

Implements the [MCP Streamable HTTP specification](https://spec.modelcontextprotocol.io/specification/transport/streamable-http/).

## Monitoring

### Logs

The server logs:
- New session creation
- Session cleanup (expired sessions)
- Errors and exceptions
- Graceful shutdown events

```bash
# View logs with systemd
sudo journalctl -u yt-dlp-mcp-http -f

# View logs with Docker
docker logs -f container-name
```

### Metrics

Check active sessions via health endpoint:
```bash
curl http://localhost:3000/health
```

## Troubleshooting

### Server won't start

```bash
# Check if yt-dlp is installed
yt-dlp --version

# Check port availability
lsof -i :3000

# Check downloads directory permissions
ls -la $YTDLP_DOWNLOADS_DIR
```

### 401 Unauthorized

- Verify API key is set: `echo $YTDLP_API_KEY`
- Check client is sending `Authorization: Bearer <key>` header
- Ensure no extra whitespace in the key

### 429 Rate Limit

- Increase rate limit: `export YTDLP_RATE_LIMIT=120`
- Check if client is reusing sessions properly
- Verify session IDs are being tracked

### CORS Errors

```bash
# Allow specific origin
export YTDLP_CORS_ORIGIN=https://your-app.com

# Allow all origins (development only)
export YTDLP_CORS_ORIGIN=*
```

## Architecture

### Streamable HTTP Transport

The server uses the official MCP Streamable HTTP transport which:
- Supports Server-Sent Events (SSE) for streaming responses
- Maintains stateful sessions with automatic cleanup
- Provides JSON-RPC 2.0 message handling
- Implements protocol version negotiation

### Session Management

- Each client connection creates a unique session (UUID)
- Sessions auto-expire after inactivity (default: 1 hour)
- Expired sessions are cleaned up every 5 minutes
- Rate limiting is per-session

### Security Layers

```
Client Request
    ↓
CORS Middleware (Origin validation)
    ↓
API Key Middleware (Bearer token)
    ↓
Rate Limiting (Per-session counter)
    ↓
MCP Transport (Request validation, 4MB limit)
    ↓
Tool Handlers (Zod schema validation)
    ↓
yt-dlp Execution
```

## Performance

### Benchmarks

- ~50-100ms latency for metadata operations
- ~200-500ms for search operations
- Download speeds limited by yt-dlp and network bandwidth
- Can handle 100+ concurrent sessions on modern hardware

### Optimization Tips

1. Use SSD for downloads directory
2. Increase rate limits for trusted clients
3. Deploy on server with good bandwidth
4. Use CDN/caching for frequently accessed videos
5. Monitor and tune session timeout based on usage

## Comparison: HTTP vs Stdio

| Feature | HTTP Server | Stdio (Local) |
|---------|-------------|---------------|
| Remote Access | ✅ Yes | ❌ No |
| Multi-client | ✅ Yes | ❌ No |
| Authentication | ✅ API Keys | ❌ N/A |
| Rate Limiting | ✅ Built-in | ❌ No |
| Session Management | ✅ Stateful | ❌ Stateless |
| Setup Complexity | Medium | Easy |
| Latency | Higher | Lower |
| Use Case | Production, Teams | Personal, Development |

## License

Same as parent project (MIT)

## Support

- GitHub Issues: https://github.com/kevinwatt/yt-dlp-mcp/issues
- MCP Specification: https://spec.modelcontextprotocol.io
