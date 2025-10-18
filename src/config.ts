import * as os from "os";
import * as path from "path";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Configuration type definitions
 */
export interface Config {
  // File-related configuration
  file: {
    maxFilenameLength: number;
    downloadsDir: string;
    tempDirPrefix: string;
    // Filename processing configuration
    sanitize: {
      // Character to replace illegal characters
      replaceChar: string;
      // Suffix when truncating filenames
      truncateSuffix: string;
      // Regular expression for illegal characters
      illegalChars: RegExp;
      // List of reserved names
      reservedNames: readonly string[];
    };
  };
  // Tool-related configuration
  tools: {
    required: readonly string[];
  };
  // Download-related configuration
  download: {
    defaultResolution: "480p" | "720p" | "1080p" | "best";
    defaultAudioFormat: "m4a" | "mp3";
    defaultSubtitleLanguage: string;
  };
  // Response limits
  limits: {
    characterLimit: number;
    maxTranscriptLength: number;
  };
}

/**
 * Default configuration
 */
const defaultConfig: Config = {
  file: {
    maxFilenameLength: 50,
    downloadsDir: path.join(os.homedir(), "Downloads"),
    tempDirPrefix: "ytdlp-",
    sanitize: {
      replaceChar: '_',
      truncateSuffix: '...',
      illegalChars: /[<>:"/\\|?*\x00-\x1F]/g,  // Windows illegal characters
      reservedNames: [
        'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
        'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2',
        'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
      ]
    }
  },
  tools: {
    required: ['yt-dlp']
  },
  download: {
    defaultResolution: "720p",
    defaultAudioFormat: "m4a",
    defaultSubtitleLanguage: "en"
  },
  limits: {
    characterLimit: 25000,      // Standard MCP character limit
    maxTranscriptLength: 50000  // Transcripts can be larger
  }
};

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): DeepPartial<Config> {
  const envConfig: DeepPartial<Config> = {};

  // File configuration
  const fileConfig: DeepPartial<Config['file']> = {
    sanitize: {
      replaceChar: process.env.YTDLP_SANITIZE_REPLACE_CHAR,
      truncateSuffix: process.env.YTDLP_SANITIZE_TRUNCATE_SUFFIX,
      illegalChars: process.env.YTDLP_SANITIZE_ILLEGAL_CHARS ? new RegExp(process.env.YTDLP_SANITIZE_ILLEGAL_CHARS) : undefined,
      reservedNames: process.env.YTDLP_SANITIZE_RESERVED_NAMES?.split(',')
    }
  };
  
  if (process.env.YTDLP_MAX_FILENAME_LENGTH) {
    fileConfig.maxFilenameLength = parseInt(process.env.YTDLP_MAX_FILENAME_LENGTH);
  }
  if (process.env.YTDLP_DOWNLOADS_DIR) {
    fileConfig.downloadsDir = process.env.YTDLP_DOWNLOADS_DIR;
  }
  if (process.env.YTDLP_TEMP_DIR_PREFIX) {
    fileConfig.tempDirPrefix = process.env.YTDLP_TEMP_DIR_PREFIX;
  }

  if (Object.keys(fileConfig).length > 0) {
    envConfig.file = fileConfig;
  }

  // Download configuration
  const downloadConfig: Partial<Config['download']> = {};
  if (process.env.YTDLP_DEFAULT_RESOLUTION && 
      ['480p', '720p', '1080p', 'best'].includes(process.env.YTDLP_DEFAULT_RESOLUTION)) {
    downloadConfig.defaultResolution = process.env.YTDLP_DEFAULT_RESOLUTION as Config['download']['defaultResolution'];
  }
  if (process.env.YTDLP_DEFAULT_AUDIO_FORMAT && 
      ['m4a', 'mp3'].includes(process.env.YTDLP_DEFAULT_AUDIO_FORMAT)) {
    downloadConfig.defaultAudioFormat = process.env.YTDLP_DEFAULT_AUDIO_FORMAT as Config['download']['defaultAudioFormat'];
  }
  if (process.env.YTDLP_DEFAULT_SUBTITLE_LANG) {
    downloadConfig.defaultSubtitleLanguage = process.env.YTDLP_DEFAULT_SUBTITLE_LANG;
  }
  if (Object.keys(downloadConfig).length > 0) {
    envConfig.download = downloadConfig;
  }

  return envConfig;
}

/**
 * Validate configuration
 */
function validateConfig(config: Config): void {
  // Validate filename length
  if (config.file.maxFilenameLength < 5) {
    throw new Error('maxFilenameLength must be at least 5');
  }

  // Validate downloads directory
  if (!config.file.downloadsDir) {
    throw new Error('downloadsDir must be specified');
  }

  // Validate temporary directory prefix
  if (!config.file.tempDirPrefix) {
    throw new Error('tempDirPrefix must be specified');
  }

  // Validate default resolution
  if (!['480p', '720p', '1080p', 'best'].includes(config.download.defaultResolution)) {
    throw new Error('Invalid defaultResolution');
  }

  // Validate default audio format
  if (!['m4a', 'mp3'].includes(config.download.defaultAudioFormat)) {
    throw new Error('Invalid defaultAudioFormat');
  }

  // Validate default subtitle language
  if (!/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/i.test(config.download.defaultSubtitleLanguage)) {
    throw new Error('Invalid defaultSubtitleLanguage');
  }
}

/**
 * Merge configuration
 */
function mergeConfig(base: Config, override: DeepPartial<Config>): Config {
  return {
    file: {
      maxFilenameLength: override.file?.maxFilenameLength || base.file.maxFilenameLength,
      downloadsDir: override.file?.downloadsDir || base.file.downloadsDir,
      tempDirPrefix: override.file?.tempDirPrefix || base.file.tempDirPrefix,
      sanitize: {
        replaceChar: override.file?.sanitize?.replaceChar || base.file.sanitize.replaceChar,
        truncateSuffix: override.file?.sanitize?.truncateSuffix || base.file.sanitize.truncateSuffix,
        illegalChars: (override.file?.sanitize?.illegalChars || base.file.sanitize.illegalChars) as RegExp,
        reservedNames: (override.file?.sanitize?.reservedNames || base.file.sanitize.reservedNames) as readonly string[]
      }
    },
    tools: {
      required: (override.tools?.required || base.tools.required) as readonly string[]
    },
    download: {
      defaultResolution: override.download?.defaultResolution || base.download.defaultResolution,
      defaultAudioFormat: override.download?.defaultAudioFormat || base.download.defaultAudioFormat,
      defaultSubtitleLanguage: override.download?.defaultSubtitleLanguage || base.download.defaultSubtitleLanguage
    },
    limits: {
      characterLimit: override.limits?.characterLimit || base.limits.characterLimit,
      maxTranscriptLength: override.limits?.maxTranscriptLength || base.limits.maxTranscriptLength
    }
  };
}

/**
 * Load configuration
 */
export function loadConfig(): Config {
  const envConfig = loadEnvConfig();
  const config = mergeConfig(defaultConfig, envConfig);
  validateConfig(config);
  return config;
}

/**
 * Safe filename processing function
 */
export function sanitizeFilename(filename: string, config: Config['file']): string {
  // Remove illegal characters
  let safe = filename.replace(config.sanitize.illegalChars, config.sanitize.replaceChar);
  
  // Check reserved names
  const basename = path.parse(safe).name.toUpperCase();
  if (config.sanitize.reservedNames.includes(basename)) {
    safe = `_${safe}`;
  }
  
  // Handle length limitation
  if (safe.length > config.maxFilenameLength) {
    const ext = path.extname(safe);
    const name = safe.slice(0, config.maxFilenameLength - ext.length - config.sanitize.truncateSuffix.length);
    safe = `${name}${config.sanitize.truncateSuffix}${ext}`;
  }
  
  return safe;
}

// Export current configuration instance
export const CONFIG = loadConfig(); 