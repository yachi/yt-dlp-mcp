import { _spawnPromise } from "./utils.js";
import type { Config } from "../config.js";

/**
 * YouTube search result interface
 */
export interface SearchResult {
  title: string;
  id: string;
  url: string;
  uploader?: string;
  duration?: string;
  viewCount?: string;
  uploadDate?: string;
}

/**
 * Search YouTube videos
 * @param query Search keywords
 * @param maxResults Maximum number of results (1-50)
 * @param config Configuration object
 * @returns Search results formatted as string
 */
export async function searchVideos(
  query: string,
  maxResults: number = 10,
  config: Config
): Promise<string> {
  // Validate parameters
  if (!query || query.trim().length === 0) {
    throw new Error("Search query cannot be empty");
  }

  if (maxResults < 1 || maxResults > 50) {
    throw new Error("Number of results must be between 1 and 50");
  }

  const cleanQuery = query.trim();
  const searchQuery = `ytsearch${maxResults}:${cleanQuery}`;

  try {
    // Use yt-dlp to search and get video information
    const args = [
      searchQuery,
      "--print", "title",
      "--print", "id", 
      "--print", "uploader",
      "--print", "duration",
      "--no-download",
      "--quiet"
    ];

    const result = await _spawnPromise(config.tools.required[0], args);
    
    if (!result || result.trim().length === 0) {
      return "No videos found";
    }

    // Parse results
    const lines = result.trim().split('\n');
    const results: SearchResult[] = [];
    
    // Each video has 4 lines of data: title, id, uploader, duration
    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 < lines.length) {
        const title = lines[i]?.trim();
        const id = lines[i + 1]?.trim();
        const uploader = lines[i + 2]?.trim();
        const duration = lines[i + 3]?.trim();

        if (title && id) {
          const url = `https://www.youtube.com/watch?v=${id}`;
          results.push({
            title,
            id,
            url,
            uploader: uploader || "Unknown",
            duration: duration || "Unknown"
          });
        }
      }
    }

    if (results.length === 0) {
      return "No videos found";
    }

    // Format output
    let output = `Found ${results.length} video${results.length > 1 ? 's' : ''}:\n\n`;
    
    results.forEach((video, index) => {
      output += `${index + 1}. **${video.title}**\n`;
      output += `   📺 Channel: ${video.uploader}\n`;
      output += `   ⏱️  Duration: ${video.duration}\n`;
      output += `   🔗 URL: ${video.url}\n`;
      output += `   🆔 ID: ${video.id}\n\n`;
    });

    output += "💡 You can use any URL to download videos, audio, or subtitles!";

    return output;

  } catch (error) {
    throw new Error(`Error searching videos: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Search videos on specific platform (future expansion feature)
 * @param query Search keywords
 * @param platform Platform name ('youtube', 'bilibili', etc.)
 * @param maxResults Maximum number of results
 * @param config Configuration object
 */
export async function searchByPlatform(
  query: string,
  platform: string = 'youtube',
  maxResults: number = 10,
  config: Config
): Promise<string> {
  // Currently only supports YouTube, can be expanded to other platforms in the future
  if (platform.toLowerCase() !== 'youtube') {
    throw new Error(`Currently only supports YouTube search, ${platform} is not supported`);
  }

  return searchVideos(query, maxResults, config);
} 