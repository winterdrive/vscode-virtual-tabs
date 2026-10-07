import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { PathUtils } from './PathUtils.js';

export interface ExploreOptions {
  pattern?: string;     // Glob pattern, e.g. "**/*.ts"
  extension?: string;   // Extension filter, e.g. ".ts" or "ts"
  directory?: string;   // Directory filter, e.g. "src/auth"
  maxResults?: number;  // Max results, default 100
}

export class ProjectExplorer {
  private pathUtils: PathUtils;

  constructor(private readonly workspaceRoot: string) {
    this.pathUtils = new PathUtils(workspaceRoot);
  }

  /**
   * Explore project files.
   * Uses fast-glob syntax; excludes node_modules and other commonly ignored directories.
   */
  async exploreProject(options: ExploreOptions): Promise<{ files: string[], truncated: boolean }> {
    const { pattern = '**/*', extension, directory, maxResults: requestedMaxResults = 100 } = options;
    // Guard against non-positive/non-integer values (e.g. 0 or negative), which would
    // otherwise make Array.slice(0, maxResults) silently drop items from the end.
    const maxResults = Number.isInteger(requestedMaxResults) && requestedMaxResults > 0
      ? requestedMaxResults
      : 100;

    let baseDir = this.workspaceRoot;
    if (directory) {
      const targetDir = path.isAbsolute(directory)
        ? directory
        : path.join(this.workspaceRoot, directory);

      if (!this.pathUtils.validatePath(targetDir)) {
        throw new Error(`The specified directory is outside the workspace or invalid: ${directory}`);
      }
      baseDir = targetDir;
    }

    let searchPattern = pattern;
    if (extension) {
      const ext = extension.startsWith('.') ? extension : `.${extension}`;
      if (searchPattern === '**/*') {
        searchPattern = `**/*${ext}`;
      } else if (!searchPattern.endsWith(ext)) {
        searchPattern = `${searchPattern}${ext}`;
      }
    }

    const globPattern = searchPattern.replace(/\\/g, '/');

    const ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.vscode/**'
    ];

    try {
      const entries = await fg([globPattern], {
        cwd: baseDir,
        absolute: true,
        onlyFiles: true,
        ignore: ignorePatterns
      });

      const truncated = entries.length > maxResults;
      const results = truncated ? entries.slice(0, maxResults) : entries;
      const normalizedResults = results.map(p => path.normalize(p));

      return { files: normalizedResults, truncated };
    } catch (error) {
      throw new Error(`Error exploring project: ${error}`);
    }
  }

  /**
   * Read file content (limited to 100 KB)
   */
  readFile(filePath: string): { content: string, truncated: boolean, size: number, path: string } {
    const absolutePath = this.pathUtils.toAbsolutePath(filePath);

    if (!this.pathUtils.validatePath(absolutePath)) {
      throw new Error('Path is outside the workspace');
    }

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`The specified path is not a file: ${filePath}`);
    }

    const MAX_SIZE = 100 * 1024;
    const size = stats.size;
    const truncated = size > MAX_SIZE;

    const buffer = Buffer.alloc(Math.min(size, MAX_SIZE));
    const fd = fs.openSync(absolutePath, 'r');

    try {
      // Use the actual byte count: if the file shrank after statSync (or the read
      // was short), the untouched tail of the zero-filled buffer would otherwise be
      // mistaken for NUL bytes and reported as a binary file.
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const data = buffer.subarray(0, bytesRead);

      if (data.includes(0)) {
        throw new Error('Binary files are not supported');
      }

      const content = data.toString('utf8');
      return { path: absolutePath, content, size, truncated };
    } finally {
      fs.closeSync(fd);
    }
  }
}
