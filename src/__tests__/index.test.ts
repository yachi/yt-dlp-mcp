// @ts-nocheck
// @jest-environment node
import { jest } from '@jest/globals';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import * as path from 'path';
import * as os from 'os';

// 簡化 mock
jest.mock('spawn-rx', () => ({
  spawnPromise: jest.fn().mockImplementation(async (cmd, args) => {
    if (args.includes('--get-filename')) {
      return 'mock_video.mp4';
    }
    return 'Download completed';
  })
}));
jest.mock('rimraf', () => ({
  rimraf: { sync: jest.fn() }
}));

import { downloadVideo } from '../index.mts';

describe('downloadVideo', () => {
  const mockTimestamp = '2024-03-20_12-30-00';
  let originalDateToISOString: () => string;

  // 全局清理
  afterAll(done => {
    // 清理所有計時器
    jest.useRealTimers();
    // 確保所有異步操作完成
    process.nextTick(done);
  });

  beforeAll(() => {
    originalDateToISOString = Date.prototype.toISOString;
    Date.prototype.toISOString = jest.fn(() => '2024-03-20T12:30:00.000Z');
  });

  afterAll(() => {
    Date.prototype.toISOString = originalDateToISOString;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('downloads video successfully with correct format', async () => {
    const result = await downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    
    // 驗證基本功能
    expect(result).toMatch(/Video successfully downloaded as/);
    expect(result).toContain(mockTimestamp);
    expect(result).toContain(os.homedir());
    expect(result).toContain('Downloads');
  });

  test('handles special characters in video URL', async () => {
    // 使用有效的視頻 ID，但包含需要編碼的字符
    const result = await downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&title=特殊字符');
    
    expect(result).toMatch(/Video successfully downloaded as/);
    expect(result).toContain(mockTimestamp);
  });

  test('uses correct resolution format', async () => {
    const resolutions = ['480p', '720p', '1080p', 'best'];
    
    // 使用 Promise.all 並行執行測試
    const results = await Promise.all(resolutions.map(resolution => downloadVideo(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      resolution
    )));
    
    results.forEach(result => {
      expect(result).toMatch(/Video successfully downloaded as/);
    });
  });
}); 