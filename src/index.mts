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

const VERSION = '0.6.23';

/**
 * System Configuration
 */
const CONFIG = {
  MAX_FILENAME_LENGTH: 50,
  DOWNLOADS_DIR: path.join(os.homedir(), "Downloads"),
  TEMP_DIR_PREFIX: "ytdlp-",
  REQUIRED_TOOLS: ['yt-dlp'] as const
} as const;

/**
 * Validate system configuration
 * @throws {Error} when configuration is invalid
 */
async function validateConfig(): Promise<void> {
  // Check downloads directory
  if (!fs.existsSync(CONFIG.DOWNLOADS_DIR)) {
    throw new Error(`Downloads directory does not exist: ${CONFIG.DOWNLOADS_DIR}`);
  }

  // Check downloads directory permissions
  try {
    const testFile = path.join(CONFIG.DOWNLOADS_DIR, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(`No write permission in downloads directory: ${CONFIG.DOWNLOADS_DIR}`);
  }

  // Check temporary directory permissions
  try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), CONFIG.TEMP_DIR_PREFIX));
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
  for (const tool of CONFIG.REQUIRED_TOOLS) {
    try {
      await spawnPromise(tool, ["--version"]);
    } catch (error) {
      throw new Error(`Required tool '${tool}' is not installed or not accessible`);
    }
  }
}

/**
 * Initialize service
 */
async function initialize(): Promise<void> {
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
    ],
  };
});

/**
 * Custom error types
 */
class VideoDownloadError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'UNKNOWN_ERROR',
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'VideoDownloadError';
  }
}


/**
 * Error code mappings
 */
const ERROR_CODES = {
  UNSUPPORTED_URL: 'Unsupported or invalid URL',
  VIDEO_UNAVAILABLE: 'Video is not available or has been removed',
  NETWORK_ERROR: 'Network connection error',
  FORMAT_ERROR: 'Requested format is not available',
  PERMISSION_ERROR: 'Permission denied when accessing download directory',
  SUBTITLE_ERROR: 'Failed to process subtitles',
  SUBTITLE_NOT_AVAILABLE: 'Subtitles are not available',
  INVALID_LANGUAGE: 'Invalid language code provided',
  UNKNOWN_ERROR: 'An unknown error occurred'
} as const;

/**
 * Safely clean up temporary directory
 * @param directory Directory path to clean up
 */
async function safeCleanup(directory: string): Promise<void> {
  try {
    rimraf.sync(directory);
  } catch (error) {
    console.error(`Failed to cleanup directory ${directory}:`, error);
  }
}

/**
 * Validate URL format
 * @param url URL to validate
 * @throws {VideoDownloadError} when URL is invalid
 */
function validateUrl(url: string, ErrorClass = VideoDownloadError): void {
  try {
    new URL(url);
  } catch {
    throw new ErrorClass(
      ERROR_CODES.UNSUPPORTED_URL,
      'UNSUPPORTED_URL'
    );
  }
}

/**
 * Generate formatted timestamp
 * @returns Formatted timestamp string
 */
function getFormattedTimestamp(): string {
  return new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .split('.')[0];
}

/**
 * Check if URL is a YouTube URL
 * @param url URL to check
 */
function isYouTubeUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return ['youtube.com', 'youtu.be', 'm.youtube.com']
      .some(domain => urlObj.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

/**
 * Lists all available subtitles for a video
 */
async function listSubtitles(url: string): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-"));
  
  try {
    validateUrl(url);

    // 同時列出一般字幕和自動生成的字幕
    const result = await spawnPromise(
      "yt-dlp",
      [
        "--list-subs",         // 列出一般字幕
        "--write-auto-sub",    // 包含自動生成的字幕
        "--skip-download",
        "--verbose",           // 添加詳細輸出
        url
      ],
      { cwd: tempDirectory }
    );

    // 如果沒有一般字幕，添加說明
    if (result.includes("has no subtitles")) {
      return "Regular subtitles: None\n\nAuto-generated subtitles: Available in multiple languages";
    }
    return result;
  } catch (error) {
    throw error;
  } finally {
    await safeCleanup(tempDirectory);
  }
}

/**
 * Downloads video subtitles in specified language
 */
async function downloadSubtitles(url: string, language: string = "en"): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-"));

  try {
    validateUrl(url);

    if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/i.test(language)) {
      throw new Error('Invalid language code');
    }

    try {
      const result = await spawnPromise(
        "yt-dlp",
        [
          "--write-sub",         // 嘗試下載一般字幕
          "--write-auto-sub",    // 同時支援自動生成字幕
          "--sub-lang", language,
          "--convert-subs", "srt",
          "--skip-download",
          "--verbose",           // 添加詳細輸出
          url
        ],
        { cwd: tempDirectory }
      );
      console.log("yt-dlp output:", result);
    } catch (error) {
      throw error;
    }

    // 讀取下載的字幕文件
    const files = fs.readdirSync(tempDirectory);
    console.log("Files in directory:", files);
    
    // 過濾出字幕文件
    const subtitleFiles = files.filter(file => 
      file.endsWith('.srt') || file.endsWith('.vtt')
    );

    if (subtitleFiles.length === 0) {
      throw new Error(`No subtitle files found. Available files: ${files.join(', ')}`);
    }

    // 讀取並組合字幕內容
    let subtitlesContent = "";
    for (const file of subtitleFiles) {
      const filePath = path.join(tempDirectory, file);
      try {
        const fileData = fs.readFileSync(filePath, "utf8");
        subtitlesContent += `${file}\n====================\n${fileData}\n\n`;
      } catch (error) {
        console.error(`Failed to read subtitle file ${file}:`, error);
      }
    }

    if (!subtitlesContent) {
      throw new Error("Failed to read subtitle content");
    }

    return subtitlesContent;
  } finally {
    await safeCleanup(tempDirectory);
  }
}

/**
 * Downloads a video with specified resolution
 * @param url The URL of the video
 * @param resolution The desired video resolution
 * @returns A detailed success message including the filename
 */
export async function downloadVideo(url: string, resolution = "720p"): Promise<string> {
  const userDownloadsDir = CONFIG.DOWNLOADS_DIR;
  
  try {
    validateUrl(url, VideoDownloadError);

    const timestamp = getFormattedTimestamp();
      
    let format: string;
    if (isYouTubeUrl(url)) {
      // YouTube-specific format selection
      switch (resolution) {
        case "480p":
          format = "bestvideo[height<=480]+bestaudio/best[height<=480]/best";
          break;
        case "720p":
          format = "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
          break;
        case "1080p":
          format = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
          break;
        case "best":
          format = "bestvideo+bestaudio/best";
          break;
        default:
          format = "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
      }
    } else {
      // For other platforms, use quality labels that are more generic
      switch (resolution) {
        case "480p":
          format = "worst[height>=480]/best[height<=480]/worst";
          break;
        case "best":
          format = "bestvideo+bestaudio/best";
          break;
        default: // Including 720p and 1080p cases
          // Prefer HD quality but fallback to best available
          format = "bestvideo[height>=720]+bestaudio/best[height>=720]/best";
      }
    }
    
    const outputTemplate = path.join(
      userDownloadsDir,
      `%(title).${CONFIG.MAX_FILENAME_LENGTH}s [%(id)s] ${timestamp}.%(ext)s`
    );

    // Get expected filename
    let expectedFilename: string;
    try {
      expectedFilename = await spawnPromise("yt-dlp", [
        "--get-filename",
        "-f", format,
        "--output", outputTemplate,
        url
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Unsupported URL')) {
        throw new VideoDownloadError(
          ERROR_CODES.UNSUPPORTED_URL,
          'UNSUPPORTED_URL',
          error as Error
        );
      }
      if (errorMessage.includes('not available')) {
        throw new VideoDownloadError(
          ERROR_CODES.VIDEO_UNAVAILABLE,
          'VIDEO_UNAVAILABLE',
          error as Error
        );
      }
      throw new VideoDownloadError(
        ERROR_CODES.UNKNOWN_ERROR,
        'UNKNOWN_ERROR',
        error as Error
      );
    }

    expectedFilename = expectedFilename.trim();
    
    // Download with progress info
    try {
      await spawnPromise("yt-dlp", [
        "--progress",
        "--newline",
        "--no-mtime",
        "-f", format,
        "--output", outputTemplate,
        url
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Permission denied')) {
        throw new VideoDownloadError(
          ERROR_CODES.PERMISSION_ERROR,
          'PERMISSION_ERROR',
          error as Error
        );
      }
      if (errorMessage.includes('format not available')) {
        throw new VideoDownloadError(
          ERROR_CODES.FORMAT_ERROR,
          'FORMAT_ERROR',
          error as Error
        );
      }
      throw new VideoDownloadError(
        ERROR_CODES.UNKNOWN_ERROR,
        'UNKNOWN_ERROR',
        error as Error
      );
    }

    return `Video successfully downloaded as "${path.basename(expectedFilename)}" to ${userDownloadsDir}`;
  } catch (error) {
    if (error instanceof VideoDownloadError) {
      throw error;
    }
    throw new VideoDownloadError(
      ERROR_CODES.UNKNOWN_ERROR,
      'UNKNOWN_ERROR',
      error as Error
    );
  }
}

/**
 * Downloads audio from video in m4a format
 * @param url The URL of the video
 * @returns A detailed success message including the filename
 */
async function downloadAudio(url: string): Promise<string> {
  const userDownloadsDir = CONFIG.DOWNLOADS_DIR;
  
  try {
    validateUrl(url);
    const timestamp = getFormattedTimestamp();
    
    const outputTemplate = path.join(
      userDownloadsDir,
      `%(title).${CONFIG.MAX_FILENAME_LENGTH}s [%(id)s] ${timestamp}.%(ext)s`
    );

    let format: string;
    if (isYouTubeUrl(url)) {
      format = "140/bestaudio[ext=m4a]/bestaudio";  // 優先選擇 m4a
    } else {
      format = "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";  // 優先選擇 m4a/mp3
    }

    // Download audio with verbose output
    try {
      await spawnPromise("yt-dlp", [
        "--verbose",           // 添加詳細輸出
        "--progress",
        "--newline",
        "--no-mtime",
        "-f", format,
        "--output", outputTemplate,
        url
      ]);

      // 如果下載成功，返回成功消息
      const files = fs.readdirSync(userDownloadsDir);
      const downloadedFile = files.find(file => file.includes(timestamp));
      if (!downloadedFile) {
        throw new Error("Download completed but file not found");
      }
      return `Audio successfully downloaded as "${downloadedFile}" to ${userDownloadsDir}`;

    } catch (error) {
      // 直接拋出原始錯誤信息
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`yt-dlp error: ${errorMessage}`);
    }
  } catch (error) {
    // 不再包裝錯誤，直接拋出
    throw error;
  }
}

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
    };

    if (toolName === "list_subtitle_languages") {
      return handleToolExecution(
        () => listSubtitles(args.url),
        "Error listing subtitle languages"
      );
    } else if (toolName === "download_video_subtitles") {
      return handleToolExecution(
        () => downloadSubtitles(args.url, args.language),
        "Error downloading subtitles"
      );
    } else if (toolName === "download_video") {
      return handleToolExecution(
        () => downloadVideo(args.url, args.resolution),
        "Error downloading video"
      );
    } else if (toolName === "download_audio") {
      return handleToolExecution(
        () => downloadAudio(args.url),
        "Error downloading audio"
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

// 導出錯誤類型供測試使用
export { VideoDownloadError, ERROR_CODES };
