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

const VERSION = '0.6.10';

/**
 * 系統配置
 */
const CONFIG = {
  MAX_FILENAME_LENGTH: 50,
  DOWNLOADS_DIR: path.join(os.homedir(), "Downloads"),
  TEMP_DIR_PREFIX: "ytdlp-",
  REQUIRED_TOOLS: ['yt-dlp'] as const
} as const;

/**
 * 驗證系統配置
 * @throws {Error} 當配置無效時
 */
async function validateConfig(): Promise<void> {
  // 檢查下載目錄
  if (!fs.existsSync(CONFIG.DOWNLOADS_DIR)) {
    throw new Error(`Downloads directory does not exist: ${CONFIG.DOWNLOADS_DIR}`);
  }

  // 檢查下載目錄權限
  try {
    const testFile = path.join(CONFIG.DOWNLOADS_DIR, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(`No write permission in downloads directory: ${CONFIG.DOWNLOADS_DIR}`);
  }

  // 檢查臨時目錄權限
  try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), CONFIG.TEMP_DIR_PREFIX));
    await safeCleanup(testDir);
  } catch (error) {
    throw new Error(`Cannot create temporary directory in: ${os.tmpdir()}`);
  }
}

/**
 * 檢查必要的外部依賴
 * @throws {Error} 當依賴不滿足時
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
 * 初始化服務
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
        name: "list_video_subtitles",
        description: "List all available subtitles for a video",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
          },
          required: ["url"],
        },
      },
      {
        name: "download_video_srt",
        description: "Download video subtitles in SRT format. Default language is English, falls back to available languages.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the video" },
            language: { type: "string", description: "Language code (e.g., 'en', 'zh-Hant', 'ja'). Optional, defaults to 'en'" },
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
    ],
  };
});

/**
 * 自定義錯誤類型
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

class SubtitleError extends VideoDownloadError {
  constructor(message: string, code: string = 'SUBTITLE_ERROR', cause?: Error) {
    super(message, code, cause);
    this.name = 'SubtitleError';
  }
}

/**
 * 錯誤代碼映射
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
 * 安全地清理臨時目錄
 * @param directory 要清理的目錄路徑
 */
async function safeCleanup(directory: string): Promise<void> {
  try {
    rimraf.sync(directory);
  } catch (error) {
    console.error(`Failed to cleanup directory ${directory}:`, error);
  }
}

/**
 * 驗證 URL 格式
 * @param url 要驗證的 URL
 * @throws {VideoDownloadError} 當 URL 無效時
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
 * 生成格式化的時間戳
 * @returns 格式化的時間戳字符串
 */
function getFormattedTimestamp(): string {
  return new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .split('.')[0];
}

/**
 * 檢查是否為 YouTube URL
 * @param url 要檢查的 URL
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
 * @param url The URL of the video
 * @returns Formatted list of available subtitles
 */
async function listSubtitles(url: string): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-"));
  
  try {
    validateUrl(url, SubtitleError);

    const result = await spawnPromise(
      "yt-dlp",
      ["--list-subs", "--skip-download", url],
      { cwd: tempDirectory }
    );
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('no subtitles')) {
      throw new SubtitleError(
        ERROR_CODES.SUBTITLE_NOT_AVAILABLE,
        'SUBTITLE_NOT_AVAILABLE',
        error as Error
      );
    }
    throw new SubtitleError(
      ERROR_CODES.SUBTITLE_ERROR,
      'SUBTITLE_ERROR',
      error as Error
    );
  } finally {
    await safeCleanup(tempDirectory);
  }
}

/**
 * Downloads video subtitles in specified language
 * @param url The URL of the video
 * @param language The language code for subtitles
 * @returns Subtitle content
 */
async function downloadSubtitles(url: string, language: string = "en"): Promise<string> {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-"));

  try {
    validateUrl(url, SubtitleError);

    // 驗證語言代碼格式
    if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/i.test(language)) {
      throw new SubtitleError(
        ERROR_CODES.INVALID_LANGUAGE,
        'INVALID_LANGUAGE'
      );
    }

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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('no subtitles')) {
        throw new SubtitleError(
          ERROR_CODES.SUBTITLE_NOT_AVAILABLE,
          'SUBTITLE_NOT_AVAILABLE',
          error as Error
        );
      }
      throw new SubtitleError(
        ERROR_CODES.SUBTITLE_ERROR,
        'SUBTITLE_ERROR',
        error as Error
      );
    }

    let subtitlesContent = "";
    const files = fs.readdirSync(tempDirectory);
    if (files.length === 0) {
      throw new SubtitleError(
        ERROR_CODES.SUBTITLE_NOT_AVAILABLE,
        'SUBTITLE_NOT_AVAILABLE'
      );
    }

    for (const file of files) {
      const filePath = path.join(tempDirectory, file);
      try {
        const fileData = fs.readFileSync(filePath, "utf8");
        subtitlesContent += `${file}\n====================\n${fileData}\n\n`;
      } catch (error) {
        console.error(`Failed to read subtitle file ${file}:`, error);
      }
    }

    if (!subtitlesContent) {
      throw new SubtitleError(
        ERROR_CODES.SUBTITLE_ERROR,
        'SUBTITLE_ERROR'
      );
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
 * 處理工具執行並統一錯誤處理
 * @param action 要執行的異步操作
 * @param errorPrefix 錯誤訊息前綴
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

    if (toolName === "list_video_subtitles") {
      return handleToolExecution(
        () => listSubtitles(args.url),
        "Error listing subtitles"
      );
    } else if (toolName === "download_video_srt") {
      return handleToolExecution(
        () => downloadSubtitles(args.url, args.language),
        "Error downloading subtitles"
      );
    } else if (toolName === "download_video") {
      return handleToolExecution(
        () => downloadVideo(args.url, args.resolution),
        "Error downloading video"
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
