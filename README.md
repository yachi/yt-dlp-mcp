# YouTube MCP Server

Uses `yt-dlp` to download YouTube content and connects it to LLMs via [Model Context Protocol](https://modelcontextprotocol.io/introduction). 

## Features

- Download YouTube subtitles (SRT format) for LLMs to read
- Download YouTube videos to your Downloads folder
- Integrates with Claude.ai and other MCP-compatible LLMs

## Installation

1. Install `yt-dlp` (Homebrew and WinGet both work great here)
2. Install this via [dive](https://github.com/OpenAgentPlatform/Dive):
   ```bash
   mcp-installer install @kevinwatt/yt-dlp-mcp
   ```

## Usage Examples

Ask your LLM to:
- "Summarize the YouTube video <<URL>>"
- "Download this YouTube video: <<URL>>"

## Manual Start

If needed, you can start the server manually:
```bash
yt-dlp-mcp
```

## Requirements

- `yt-dlp` installed and in PATH
- Node.js 20+
- MCP-compatible LLM service

