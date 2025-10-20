/**
 * MCP Server creation and tool handlers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CONFIG } from "../config.js";
import { downloadVideo } from "../modules/video.js";
import { downloadAudio } from "../modules/audio.js";
import { listSubtitles, downloadSubtitles, downloadTranscript } from "../modules/subtitle.js";
import { searchVideos } from "../modules/search.js";
import { getVideoMetadata, getVideoMetadataSummary } from "../modules/metadata.js";
import {
  SearchVideosSchema,
  ListSubtitleLanguagesSchema,
  DownloadVideoSubtitlesSchema,
  DownloadVideoSchema,
  DownloadAudioSchema,
  DownloadTranscriptSchema,
  GetVideoMetadataSchema,
  GetVideoMetadataSummarySchema,
} from "./schemas.mjs";
import { VERSION } from "../http/config.mjs";

/**
 * Convert Zod schema to JSON Schema with additionalProperties: true
 * This ensures n8n's json-schema-to-zod conversion works correctly
 */
function toJSONSchemaWithAdditionalProps(schema: z.ZodType): any {
  const jsonSchema = z.toJSONSchema(schema);
  return {
    ...jsonSchema,
    additionalProperties: true
  };
}

/**
 * Generic tool execution handler with error handling
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
 * Create and configure MCP server with all tool handlers
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "yt-dlp-mcp-http",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {}
      },
    }
  );

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "ytdlp_search_videos",
          description: "Search for videos on YouTube with pagination support",
          inputSchema: toJSONSchemaWithAdditionalProps(SearchVideosSchema),
        },
        {
          name: "ytdlp_list_subtitle_languages",
          description: "List all available subtitle languages for a video",
          inputSchema: toJSONSchemaWithAdditionalProps(ListSubtitleLanguagesSchema),
        },
        {
          name: "ytdlp_download_video_subtitles",
          description: "Download video subtitles in VTT format",
          inputSchema: toJSONSchemaWithAdditionalProps(DownloadVideoSubtitlesSchema),
        },
        {
          name: "ytdlp_download_video",
          description: "Download video file to Downloads folder",
          inputSchema: toJSONSchemaWithAdditionalProps(DownloadVideoSchema),
        },
        {
          name: "ytdlp_download_audio",
          description: "Extract and download audio from video",
          inputSchema: toJSONSchemaWithAdditionalProps(DownloadAudioSchema),
        },
        {
          name: "ytdlp_download_transcript",
          description: "Generate clean plain text transcript",
          inputSchema: toJSONSchemaWithAdditionalProps(DownloadTranscriptSchema),
        },
        {
          name: "ytdlp_get_video_metadata",
          description: "Extract comprehensive video metadata in JSON format",
          inputSchema: toJSONSchemaWithAdditionalProps(GetVideoMetadataSchema),
        },
        {
          name: "ytdlp_get_video_metadata_summary",
          description: "Get human-readable summary of key video information",
          inputSchema: toJSONSchemaWithAdditionalProps(GetVideoMetadataSummarySchema),
        },
      ],
    };
  });

  // Register call tool handler
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
        offset?: number;
        response_format?: string;
        fields?: string[];
      };

      try {
        switch (toolName) {
          case "ytdlp_search_videos": {
            const validated = SearchVideosSchema.parse(args);
            return handleToolExecution(
              () => searchVideos(
                validated.query,
                validated.maxResults,
                validated.offset,
                validated.response_format,
                CONFIG
              ),
              "Error searching videos"
            );
          }

          case "ytdlp_list_subtitle_languages": {
            const validated = ListSubtitleLanguagesSchema.parse(args);
            return handleToolExecution(
              () => listSubtitles(validated.url),
              "Error listing subtitle languages"
            );
          }

          case "ytdlp_download_video_subtitles": {
            const validated = DownloadVideoSubtitlesSchema.parse(args);
            return handleToolExecution(
              () => downloadSubtitles(
                validated.url,
                validated.language || CONFIG.download.defaultSubtitleLanguage,
                CONFIG
              ),
              "Error downloading subtitles"
            );
          }

          case "ytdlp_download_video": {
            const validated = DownloadVideoSchema.parse(args);
            return handleToolExecution(
              () => downloadVideo(
                validated.url,
                CONFIG,
                validated.resolution as "480p" | "720p" | "1080p" | "best" | undefined,
                validated.startTime,
                validated.endTime
              ),
              "Error downloading video"
            );
          }

          case "ytdlp_download_audio": {
            const validated = DownloadAudioSchema.parse(args);
            return handleToolExecution(
              () => downloadAudio(validated.url, CONFIG),
              "Error downloading audio"
            );
          }

          case "ytdlp_download_transcript": {
            const validated = DownloadTranscriptSchema.parse(args);
            return handleToolExecution(
              () => downloadTranscript(
                validated.url,
                validated.language || CONFIG.download.defaultSubtitleLanguage,
                CONFIG
              ),
              "Error downloading transcript"
            );
          }

          case "ytdlp_get_video_metadata": {
            const validated = GetVideoMetadataSchema.parse(args);
            return handleToolExecution(
              () => getVideoMetadata(validated.url, validated.fields, CONFIG),
              "Error extracting video metadata"
            );
          }

          case "ytdlp_get_video_metadata_summary": {
            const validated = GetVideoMetadataSummarySchema.parse(args);
            return handleToolExecution(
              () => getVideoMetadataSummary(validated.url, CONFIG),
              "Error generating video metadata summary"
            );
          }

          default:
            return {
              content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
              isError: true
            };
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
          return {
            content: [{ type: "text", text: `Invalid input: ${errorMessages}` }],
            isError: true
          };
        }
        throw error;
      }
    }
  );

  return server;
}
