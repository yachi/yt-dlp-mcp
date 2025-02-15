#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { spawnPromise } from "spawn-rx";
import { rimraf } from "rimraf";

const server = new Server(
  {
    name: "yt-dlp-mcp",
    version: "0.6.9",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Returns the list of available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_youtube_subtitles",
        description: "List all available subtitles for a YouTube video",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the YouTube video" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_youtube_srt",
        description: "Download YouTube subtitles in SRT format. Default language is English, falls back to available languages.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the YouTube video" },
            language: { type: "string", description: "Language code (e.g., 'en', 'zh-Hant', 'ja'). Optional, defaults to 'en'" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_youtube_video",
        description:
          "Download YouTube video to the user's default Downloads folder (usually ~/Downloads).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the YouTube video" },
            resolution: { 
              type: "string", 
              description: "Video resolution (e.g., '720p', '1080p'). Optional, defaults to '720p'",
              enum: ["480p", "720p", "1080p", "best"]
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

/**
 * Lists all available subtitles for a YouTube video
 * @param url The URL of the YouTube video
 * @returns Formatted list of available subtitles
 */
async function listSubtitles(url: string): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-"));
  
  try {
    const result = await spawnPromise(
      "yt-dlp",
      ["--list-subs", "--skip-download", url],
      { cwd: tempDirectory }
    );
    return result;
  } finally {
    rimraf.sync(tempDirectory);
  }
}

/**
 * Downloads YouTube subtitles in specified language
 * @param url The URL of the YouTube video
 * @param language The language code for subtitles
 * @returns Subtitle content
 */
async function downloadSubtitles(url: string, language: string = "en"): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-"));

  try {
    await spawnPromise(
      "yt-dlp",
      [
        "--write-sub",
        "--write-auto-sub",
        "--sub-lang",
        language,
        "--skip-download",
        "--sub-format",
        "srt",
        url,
      ],
      { cwd: tempDirectory }
    );

    let subtitlesContent = "";
    const files = fs.readdirSync(tempDirectory);
    for (const file of files) {
      const filePath = path.join(tempDirectory, file);
      const fileData = fs.readFileSync(filePath, "utf8");
      subtitlesContent += `${file}\n====================\n${fileData}\n\n`;
    }
    return subtitlesContent;
  } finally {
    rimraf.sync(tempDirectory);
  }
}

/**
 * Downloads a YouTube video with specified resolution
 * @param url The URL of the YouTube video
 * @param resolution The desired video resolution
 * @returns A detailed success message including the filename
 */
async function downloadVideo(url: string, resolution: string = "720p"): Promise<string> {
  const userDownloadsDir = path.join(os.homedir(), "Downloads");
  
  try {
    // Get current timestamp for filename
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('.')[0];
      
    // Map resolution to yt-dlp format
    const formatMap: Record<string, string> = {
      "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
      "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
      "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
      "best": "bestvideo+bestaudio/best"
    };
    
    const format = formatMap[resolution] || formatMap["720p"];
    
    const outputTemplate = path.join(
      userDownloadsDir,
      // Limit title length to 50 characters
      `%(title).50s [%(id)s] ${timestamp}.%(ext)s`
    );

    // Get expected filename
    const infoResult = await spawnPromise("yt-dlp", [
      "--get-filename",
      "-f", format,
      "--output", outputTemplate,
      url
    ]);
    const expectedFilename = infoResult.trim();
    
    // Download with progress info
    await spawnPromise("yt-dlp", [
      "--progress",
      "--newline",
      "--no-mtime",
      "-f", format,
      "--output", outputTemplate,
      url
    ]);

    return `Video successfully downloaded as "${path.basename(expectedFilename)}" to ${userDownloadsDir}`;
  } catch (error) {
    throw new Error(`Failed to download video: ${error}`);
  }
}

/**
 * Handles tool execution requests.
 */
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments as { 
      url: string;
      language?: string;
      resolution?: string;
    };

    if (toolName === "list_youtube_subtitles") {
      try {
        const subtitlesList = await listSubtitles(args.url);
        return {
          content: [{ type: "text", text: subtitlesList }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing subtitles: ${error}` }],
          isError: true,
        };
      }
    } else if (toolName === "download_youtube_srt") {
      try {
        const subtitles = await downloadSubtitles(args.url, args.language);
        return {
          content: [{ type: "text", text: subtitles }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error downloading subtitles: ${error}` }],
          isError: true,
        };
      }
    } else if (toolName === "download_youtube_video") {
      try {
        const message = await downloadVideo(args.url, args.resolution);
        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error downloading video: ${error}` }],
          isError: true,
        };
      }
    } else {
      throw new Error(`Unknown tool: ${toolName}`);
    }
  }
);

/**
 * Starts the server using Stdio transport.
 */
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start the server and handle potential errors
startServer().catch(console.error);
