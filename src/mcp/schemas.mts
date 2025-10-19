/**
 * Zod validation schemas for MCP tool inputs
 */

import { z } from "zod";

// Common field patterns
const urlField = z.string().url();
const languageField = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);
const timestampField = z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/);

export const SearchVideosSchema = z.object({
  query: z.string().min(1).max(200),
  maxResults: z.number().int().min(1).max(50).default(10).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  response_format: z.enum(["json", "markdown"]).default("markdown").optional(),
}).passthrough();

export const ListSubtitleLanguagesSchema = z.object({
  url: urlField,
}).passthrough();

export const DownloadVideoSubtitlesSchema = z.object({
  url: urlField,
  language: languageField.optional(),
}).passthrough();

export const DownloadVideoSchema = z.object({
  url: urlField,
  resolution: z.enum(["480p", "720p", "1080p", "best"]).optional(),
  startTime: timestampField.optional(),
  endTime: timestampField.optional(),
}).passthrough();

export const DownloadAudioSchema = z.object({
  url: urlField,
}).passthrough();

export const DownloadTranscriptSchema = z.object({
  url: urlField,
  language: languageField.optional(),
}).passthrough();

export const GetVideoMetadataSchema = z.object({
  url: urlField,
  fields: z.array(z.string()).optional(),
}).passthrough();

export const GetVideoMetadataSummarySchema = z.object({
  url: urlField,
}).passthrough();
