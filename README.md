# yt-dlp-mcp

An MCP server implementation that integrates with yt-dlp, providing YouTube content download capabilities for LLMs.

## Features

* **YouTube Subtitles**: Download subtitles in SRT format for LLMs to read
* **Video Download**: Save videos to your Downloads folder with resolution control
* **Privacy-Focused**: Direct download without tracking
* **MCP Integration**: Works with Dive and other MCP-compatible LLMs

## Installation

### Prerequisites

Install `yt-dlp` based on your operating system:

```bash
# Windows
winget install yt-dlp

# macOS
brew install yt-dlp

# Linux
pip install yt-dlp
```

### With [Dive Desktop](https://github.com/OpenAgentPlatform/Dive)

1. Click "+ Add MCP Server" in Dive Desktop
2. Copy and paste this configuration:

```json
{
  "mcpServers": {
    "yt-dlp": {
      "command": "npx",
      "args": [
        "-y",
        "@kevinwatt/yt-dlp-mcp"
      ]
    }
  }
}
```
3. Click "Save" to install the MCP server

## Tool Documentation

* **list_youtube_subtitles**
  * List all available subtitles for a YouTube video
  * Inputs:
    * `url` (string, required): URL of the YouTube video

* **download_youtube_srt**
  * Download YouTube subtitles in SRT format
  * Inputs:
    * `url` (string, required): URL of the YouTube video
    * `language` (string, optional): Language code (e.g., 'en', 'zh-Hant', 'ja'). Defaults to 'en'

* **download_youtube_video**
  * Download YouTube video to user's Downloads folder
  * Inputs:
    * `url` (string, required): URL of the YouTube video
    * `resolution` (string, optional): Video resolution ('480p', '720p', '1080p', 'best'). Defaults to '720p'

## Usage Examples

Ask your LLM to:
```
"List available subtitles for this video: https://youtube.com/watch?v=..."
"Download Chinese subtitles from this video: https://youtube.com/watch?v=..."
"Download this video in 1080p: https://youtube.com/watch?v=..."
```

## Manual Start

If needed, start the server manually:
```bash
npx @kevinwatt/yt-dlp-mcp
```

## Requirements

* Node.js 20+
* `yt-dlp` in system PATH
* MCP-compatible LLM service

## License

MIT

## Author

Dewei Yen

