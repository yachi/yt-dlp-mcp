#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "./config.js";
import { _spawnPromise, safeCleanup } from "./modules/utils.js";
import { downloadVideo } from "./modules/video.js";
import { downloadAudio } from "./modules/audio.js";
import { listSubtitles, downloadSubtitles, downloadTranscript } from "./modules/subtitle.js";
import { searchVideos } from "./modules/search.js";

const VERSION = '0.6.27';

/**
 * Validate system configuration
 * @throws {Error} when configuration is invalid
 */
async function validateConfig(): Promise<void> {
  // Check downloads directory
  if (!fs.existsSync(CONFIG.file.downloadsDir)) {
    throw new Error(`Downloads directory does not exist: ${CONFIG.file.downloadsDir}`);
  }

  // Check downloads directory permissions
  try {
    const testFile = path.join(CONFIG.file.downloadsDir, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(`No write permission in downloads directory: ${CONFIG.file.downloadsDir}`);
  }

  // Check temporary directory permissions
  try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), CONFIG.file.tempDirPrefix));
    await safeCleanup(testDir);
  } catch (error) {
    throw new Error(`Cannot create temporary directory in: ${os.tmpdir()}`);
  }
}

/**
 * Check required external dependencies
 * @throws {Error} when dependencies are not satisfied
 */
async function checkDependencies(): Promise<void> {
  for (const tool of CONFIG.tools.required) {
    try {
      await _spawnPromise(tool, ["--version"]);
    } catch (error) {
      throw new Error(`Required tool '${tool}' is not installed or not accessible`);
    }
  }
}

/**
 * Initialize service
 */
async function initialize(): Promise<void> {
  // 在測試環境中跳過初始化檢查
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    await validateConfig();
    await checkDependencies();
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}

const server = new Server(
  {
    name: "yt-dlp-mcp",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {}
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
        name: "search_videos",
        description: "Search for videos on YouTube using keywords. Returns title, uploader, duration, and URL for each result.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords or phrase" },
            maxResults: { 
              type: "number", 
              description: "Maximum number of results to return (1-50, default: 10)",
              minimum: 1,
              maximum: 50
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_subtitle_languages",
        description: "List all available subtitle languages and their formats for a video (including auto-generated captions)",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video_subtitles",
        description: "Download video subtitles in any available format. Supports both regular and auto-generated subtitles in various languages.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            language: { type: "string", description: "Language code (e.g., 'en', 'zh-Hant', 'ja'). Will try to get auto-generated subtitles if regular subtitles are not available." },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video",
        description:
          "Download video to the user's default Downloads folder (usually ~/Downloads).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            resolution: {
              type: "string",
              description: "Preferred video resolution. For YouTube: '480p', '720p', '1080p', 'best'. For other platforms: '480p' for low quality, '720p'/'1080p' for HD, 'best' for highest quality. Defaults to '720p'",
              enum: ["480p", "720p", "1080p", "best"]
            },
            startTime: {
              type: "string",
              description: "Start time for trimming (format: HH:MM:SS[.ms]) - e.g., '00:01:30' or '00:01:30.500'"
            },
            endTime: {
              type: "string",
              description: "End time for trimming (format: HH:MM:SS[.ms]) - e.g., '00:02:45' or '00:02:45.500'"
            },
          },
          required: ["url"],
        },
      },
      {
        name: "download_audio",
        description: "Download audio in best available quality (usually m4a/mp3 format) to the user's default Downloads folder (usually ~/Downloads).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_transcript",
        description: "Download and clean video subtitles to produce a plain text transcript without timestamps or formatting.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            language: { type: "string", description: "Language code (e.g., 'en', 'zh-Hant', 'ja'). Defaults to 'en'" },
          },
          required: ["url"],
        },
      },
    ],
  };
});

/**
 * Handle tool execution with unified error handling
 * @param action Async operation to execute
 * @param errorPrefix Error message prefix
 */
async function handleToolExecution<T>(
  action: () => Promise<T>,
  errorPrefix: string
): Promise<{
  content: Array<{ type: "text", text: string }>,
  isError?: boolean
}> {
  try {
    const result = await action();
    return {
      content: [{ type: "text", text: String(result) }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `${errorPrefix}: ${errorMessage}` }],
      isError: true
    };
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
      startTime?: string;
      endTime?: string;
      query?: string;
      maxResults?: number;
    };

    if (toolName === "search_videos") {
      return handleToolExecution(
        () => searchVideos(args.query!, args.maxResults || 10, CONFIG),
        "Error searching videos"
      );
    } else if (toolName === "list_subtitle_languages") {
      return handleToolExecution(
        () => listSubtitles(args.url),
        "Error listing subtitle languages"
      );
    } else if (toolName === "download_video_subtitles") {
      return handleToolExecution(
        () => downloadSubtitles(args.url, args.language || CONFIG.download.defaultSubtitleLanguage, CONFIG),
        "Error downloading subtitles"
      );
    } else if (toolName === "download_video") {
      return handleToolExecution(
        () => downloadVideo(
          args.url,
          CONFIG,
          args.resolution as "480p" | "720p" | "1080p" | "best",
          args.startTime,
          args.endTime
        ),
        "Error downloading video"
      );
    } else if (toolName === "download_audio") {
      return handleToolExecution(
        () => downloadAudio(args.url, CONFIG),
        "Error downloading audio"
      );
    } else if (toolName === "download_transcript") {
      return handleToolExecution(
        () => downloadTranscript(args.url, args.language || CONFIG.download.defaultSubtitleLanguage, CONFIG),
        "Error downloading transcript"
      );
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true
      };
    }
  }
);

/**
 * Starts the server using Stdio transport.
 */
async function startServer() {
  await initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start the server and handle potential errors
startServer().catch(console.error);
