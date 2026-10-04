import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * PathUtils
 *
 * Handles file path validation, conversion, and formatting.
 * Ensures all path operations stay within the workspace scope.
 */
export class PathUtils {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /** Convert a file:// URI or plain path into a filesystem path */
  static toFsPath(uri: string): string {
    return uri.startsWith('file://') ? fileURLToPath(uri) : uri;
  }

  /**
   * Validate whether the path is within the workspace
   */
  validatePath(filePath: string): boolean {
    try {
      const absolutePath = this.toAbsolutePath(filePath);
      const relativePath = path.relative(this.workspaceRoot, absolutePath);
      // Only a leading `..` *segment* escapes the workspace; a first segment
      // that merely starts with dots (e.g. `..config/file.ts`) is still inside.
      const escapesRoot = relativePath === '..' || relativePath.startsWith('..' + path.sep);
      return !escapesRoot && !path.isAbsolute(relativePath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert to a relative path (for saving to config files)
   */
  toRelativePath(filePath: string): string {
    if (this.isFileUri(filePath)) {
      filePath = this.fromFileUri(filePath);
    }
    if (!path.isAbsolute(filePath)) {
      return this.normalizePath(filePath);
    }
    const relativePath = path.relative(this.workspaceRoot, filePath);
    return this.normalizePath(relativePath);
  }

  /**
   * Convert to an absolute path
   */
  toAbsolutePath(filePath: string): string {
    if (this.isFileUri(filePath)) {
      return this.fromFileUri(filePath);
    }
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    return path.resolve(this.workspaceRoot, filePath);
  }

  /**
   * Convert to file:// URI format
   */
  toFileUri(filePath: string): string {
    const absolutePath = this.toAbsolutePath(filePath);
    if (process.platform === 'win32') {
      const normalized = absolutePath.replace(/\\/g, '/');
      return `file:///${normalized}`;
    }
    return `file://${absolutePath}`;
  }

  /**
   * Parse a file path from a file:// URI
   */
  fromFileUri(uri: string): string {
    if (!this.isFileUri(uri)) {
      return uri;
    }
    try {
      return fileURLToPath(uri);
    } catch (error) {
      let filePath = uri.replace(/^file:\/\//, '');
      if (process.platform === 'win32') {
        filePath = filePath.replace(/^\/([A-Za-z]:)/, '$1');
        filePath = filePath.replace(/\//g, '\\');
      }
      return filePath;
    }
  }

  private isFileUri(value: string): boolean {
    return /^file:\/\//.test(value);
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
