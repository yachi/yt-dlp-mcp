# API Reference

## Video Operations

### downloadVideo(url: string, config?: Config, resolution?: string, startTime?: string, endTime?: string): Promise<string>

Downloads a video from the specified URL with optional trimming.

**Parameters:**
- `url`: The URL of the video to download
- `config`: (Optional) Configuration object
- `resolution`: (Optional) Preferred video resolution ('480p', '720p', '1080p', 'best')
- `startTime`: (Optional) Start time for trimming (format: HH:MM:SS[.ms])
- `endTime`: (Optional) End time for trimming (format: HH:MM:SS[.ms])

**Returns:**
- Promise resolving to a success message with the downloaded file path

**Example:**
```javascript
import { downloadVideo } from '@kevinwatt/yt-dlp-mcp';

// Download with default settings
const result = await downloadVideo('https://www.youtube.com/watch?v=jNQXAC9IVRw');
console.log(result);

// Download with specific resolution
const hdResult = await downloadVideo(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  undefined,
  '1080p'
);
console.log(hdResult);

// Download with trimming
const trimmedResult = await downloadVideo(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  undefined,
  '720p',
  '00:01:30',
  '00:02:45'
);
console.log(trimmedResult);

// Download with fractional seconds
const preciseTrim = await downloadVideo(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  undefined,
  '720p',
  '00:01:30.500',
  '00:02:45.250'
);
console.log(preciseTrim);
```

## Audio Operations

### downloadAudio(url: string, config?: Config): Promise<string>

Downloads audio from the specified URL in the best available quality.

**Parameters:**
- `url`: The URL of the video to extract audio from
- `config`: (Optional) Configuration object

**Returns:**
- Promise resolving to a success message with the downloaded file path

**Example:**
```javascript
import { downloadAudio } from '@kevinwatt/yt-dlp-mcp';

const result = await downloadAudio('https://www.youtube.com/watch?v=jNQXAC9IVRw');
console.log(result);
```

## Subtitle Operations

### listSubtitles(url: string): Promise<string>

Lists all available subtitles for a video.

**Parameters:**
- `url`: The URL of the video

**Returns:**
- Promise resolving to a string containing the list of available subtitles

**Example:**
```javascript
import { listSubtitles } from '@kevinwatt/yt-dlp-mcp';

const subtitles = await listSubtitles('https://www.youtube.com/watch?v=jNQXAC9IVRw');
console.log(subtitles);
```

### downloadSubtitles(url: string, language: string): Promise<string>

Downloads subtitles for a video in the specified language.

**Parameters:**
- `url`: The URL of the video
- `language`: Language code (e.g., 'en', 'zh-Hant', 'ja')

**Returns:**
- Promise resolving to the subtitle content

**Example:**
```javascript
import { downloadSubtitles } from '@kevinwatt/yt-dlp-mcp';

const subtitles = await downloadSubtitles(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  'en'
);
console.log(subtitles);
```

## Metadata Operations

### getVideoMetadata(url: string, fields?: string[]): Promise<string>

Extract comprehensive video metadata using yt-dlp without downloading the content.

**Parameters:**
- `url`: The URL of the video to extract metadata from
- `fields`: (Optional) Specific metadata fields to extract (e.g., `['id', 'title', 'description', 'channel']`). If omitted, returns all available metadata. If provided as an empty array `[]`, returns `{}`.

**Returns:**
- Promise resolving to a JSON string of metadata (pretty-printed)

**Example:**
```javascript
import { getVideoMetadata } from '@kevinwatt/yt-dlp-mcp';

// Get all metadata
const all = await getVideoMetadata('https://www.youtube.com/watch?v=jNQXAC9IVRw');
console.log(all);

// Get specific fields only
const subset = await getVideoMetadata(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  ['id', 'title', 'description', 'channel']
);
console.log(subset);
```

### getVideoMetadataSummary(url: string): Promise<string>

Get a human-readable summary of key video metadata fields.

**Parameters:**
- `url`: The URL of the video

**Returns:**
- Promise resolving to a formatted text summary (title, channel, duration, views, upload date, description preview, etc.)

**Example:**
```javascript
import { getVideoMetadataSummary } from '@kevinwatt/yt-dlp-mcp';

const summary = await getVideoMetadataSummary('https://www.youtube.com/watch?v=jNQXAC9IVRw');
console.log(summary);
```

## Configuration

### Config Interface

```typescript
interface Config {
  file: {
    maxFilenameLength: number;
    downloadsDir: string;
    tempDirPrefix: string;
    sanitize: {
      replaceChar: string;
      truncateSuffix: string;
      illegalChars: RegExp;
      reservedNames: readonly string[];
    };
  };
  tools: {
    required: readonly string[];
  };
  download: {
    defaultResolution: "480p" | "720p" | "1080p" | "best";
    defaultAudioFormat: "m4a" | "mp3";
    defaultSubtitleLanguage: string;
  };
}
```

For detailed configuration options, see [Configuration Guide](./configuration.md). 