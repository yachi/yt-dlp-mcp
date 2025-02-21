// @ts-nocheck
// @jest-environment node
import { describe, test, expect } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import { listSubtitles, downloadSubtitles } from '../modules/subtitle.js';
import { CONFIG } from '../config.js';
import * as fs from 'fs';

describe('Subtitle Functions', () => {
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const testConfig = {
    ...CONFIG,
    file: {
      ...CONFIG.file,
      downloadsDir: path.join(os.tmpdir(), 'yt-dlp-test-downloads'),
      tempDirPrefix: 'yt-dlp-test-'
    }
  };

  beforeEach(async () => {
    await fs.promises.mkdir(testConfig.file.downloadsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(testConfig.file.downloadsDir, { recursive: true, force: true });
  });

  describe('listSubtitles', () => {
    test('lists available subtitles', async () => {
      const result = await listSubtitles(testUrl);
      expect(result).toContain('Language');
    }, 30000);

    test('handles invalid URL', async () => {
      await expect(listSubtitles('invalid-url'))
        .rejects
        .toThrow();
    });
  });

  describe('downloadSubtitles', () => {
    test('downloads auto-generated subtitles successfully', async () => {
      const result = await downloadSubtitles(testUrl, 'en', testConfig);
      expect(result).toContain('WEBVTT');
    }, 30000);

    test('handles missing language', async () => {
      await expect(downloadSubtitles(testUrl, 'xx', testConfig))
        .rejects
        .toThrow();
    });
  });
}); 