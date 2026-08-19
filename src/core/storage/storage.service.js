import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import env from "../env/env.js";

class StorageService {
  constructor() {
    this.uploadDir = path.join(process.cwd(), "uploads");
    this.init();
  }

  init() {
    if (!existsSync(this.uploadDir)) {
      fs.mkdir(this.uploadDir, { recursive: true }).catch((err) => {
        console.error("Failed to create uploads directory:", err);
      });
    }
  }

  /**
   * Uploads/moves a local file to the local "object storage" directory
   * @param {string} localFilePath - Path to local file (e.g. from multer)
   * @param {string} destKey - Target relative key (e.g. "imports/123/original.pptx")
   * @returns {Promise<string>} - The storage key
   */
  async uploadFile(localFilePath, destKey) {
    const destinationPath = path.join(this.uploadDir, destKey);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(localFilePath, destinationPath);
    // Delete the temporary file if it was a copy operation
    try {
      await fs.unlink(localFilePath);
    } catch (err) {
      // Ignore if source file doesn't exist or already removed
    }
    return destKey;
  }

  /**
   * Deletes a file from local storage
   * @param {string} destKey - Relative key
   */
  async deleteFile(destKey) {
    const filePath = path.join(this.uploadDir, destKey);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`Failed to delete file ${destKey}:`, err);
      }
    }
  }

  /**
   * Returns the public HTTP URL for a given storage key
   * @param {string} destKey - Relative key
   * @returns {string}
   */
  getUrl(destKey) {
    const host = process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${host}/uploads/${destKey.replace(/\\/g, "/")}`;
  }
}

export const storageService = new StorageService();
