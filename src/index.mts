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
    version: "0.6.7",
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
        name: "download_youtube_srt",
        description:
          "Download YouTube subtitles in SRT format so that LLM can read them.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL of the YouTube video" },
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
          },
          required: ["url"],
        },
      },
    ],
  };
});

/**
 * Downloads YouTube subtitles (SRT format) and returns the concatenated content.
 * @param url The URL of the YouTube video.
 * @returns Concatenated subtitles text.
 */
async function downloadSubtitles(url: string): Promise<string> {
  // Create a temporary directory for subtitle downloads
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-"));

  // Use yt-dlp to download subtitles without downloading the video
  await spawnPromise(
    "yt-dlp",
    [
      "--write-sub",
      "--write-auto-sub",
      "--sub-lang",
      "en",
      "--skip-download",
      "--sub-format",
      "srt",
      url,
    ],
    { cwd: tempDirectory, detached: true }
  );

  let subtitlesContent = "";
  try {
    const files = fs.readdirSync(tempDirectory);
    for (const file of files) {
      const filePath = path.join(tempDirectory, file);
      const fileData = fs.readFileSync(filePath, "utf8");
      subtitlesContent += `${file}\n====================\n${fileData}\n\n`;
    }
  } finally {
    // Clean up the temporary directory after processing
    rimraf.sync(tempDirectory);
  }
  return subtitlesContent;
}

/**
 * Downloads a YouTube video to the user's default Downloads folder.
 * @param url The URL of the YouTube video.
 * @returns A detailed success message including the filename.
 */
async function downloadVideo(url: string): Promise<string> {
  const userDownloadsDir = path.join(os.homedir(), "Downloads");
  
  try {
    // Get current timestamp for filename
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('.')[0];
      
    const outputTemplate = path.join(
      userDownloadsDir,
      // Limit title length to 50 characters to avoid filename too long error
      `%(title).50s [%(id)s] ${timestamp}.%(ext)s`
    );

    // Get expected filename
    const infoResult = await spawnPromise("yt-dlp", [
      "--get-filename",
      "--output", outputTemplate,
      url
    ]);
    const expectedFilename = infoResult.trim();
    
    // Download with progress info and use current time
    await spawnPromise("yt-dlp", [
      "--progress",
      "--newline", 
      "--no-mtime",     // Don't use video upload time
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
    const args = request.params.arguments as { url: string };

    if (toolName === "download_youtube_srt") {
      try {
        const subtitles = await downloadSubtitles(args.url);
        return {
          content: [
            {
              type: "text",
              text: subtitles,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error downloading subtitles: ${error}`,
            },
          ],
          isError: true,
        };
      }
    } else if (toolName === "download_youtube_video") {
      try {
        const message = await downloadVideo(args.url);
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error downloading video: ${error}`,
            },
          ],
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
