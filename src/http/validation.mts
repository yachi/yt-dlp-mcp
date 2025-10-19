/**
 * System validation utilities
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CONFIG } from "../config.js";
import { _spawnPromise, safeCleanup } from "../modules/utils.js";

/**
 * Validate downloads directory exists and is writable
 */
async function validateConfig(): Promise<void> {
  if (!fs.existsSync(CONFIG.file.downloadsDir)) {
    throw new Error(`Downloads directory does not exist: ${CONFIG.file.downloadsDir}`);
  }

  try {
    const testFile = path.join(CONFIG.file.downloadsDir, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
  } catch (error) {
    throw new Error(`No write permission in downloads directory: ${CONFIG.file.downloadsDir}`);
  }

  try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), CONFIG.file.tempDirPrefix));
    await safeCleanup(testDir);
  } catch (error) {
    throw new Error(`Cannot create temporary directory in: ${os.tmpdir()}`);
  }
}

/**
 * Check that required external dependencies are installed
 */
async function checkDependencies(): Promise<void> {
  for (const tool of CONFIG.tools.required) {
    try {
      await _spawnPromise(tool, ["--version"]);
    } catch (error) {
      throw new Error(`Required tool '${tool}' is not installed or not accessible`);
    }
  }
}

/**
 * Initialize and validate server environment
 */
export async function initialize(): Promise<void> {
  try {
    await validateConfig();
    await checkDependencies();
    console.log('✓ Configuration validated');
    console.log('✓ Dependencies checked');
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}
