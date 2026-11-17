/**
 * GroupManager
 *
 * Handles group CRUD operations, hierarchy management, sorting and movement.
 * Implements optimistic locking: version = file mtimeMs, effective across processes.
 *
 * Requirements: 1.3, 1.4
 */

import * as fs from 'fs';
import * as path from 'path';
import { TempGroup } from '../types.js';

/** Version conflict on concurrent write; caller should reload via loadGroups and retry */
export class OptimisticLockError extends Error {
  constructor() {
    super('Version conflict: file was modified by another process — please reload and retry');
    this.name = 'OptimisticLockError';
  }
}

export class GroupManager {
  private configPath: string;
  private cachedGroups: TempGroup[] | null = null;
  private lastModified: number = 0;

  constructor(private readonly workspaceRoot: string) {
    // Config file path: .vscode/virtualTab.json
    this.configPath = path.join(workspaceRoot, '.vscode', 'virtualTab.json');
  }

  /**
   * Get the workspace root path
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  hasConfigFile(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Load groups (optimistic locking).
   * Returns the version number (= file mtimeMs) for saveGroups to verify.
   * Multiple readers can operate fully concurrently with no waiting.
   *
   * @returns { groups, version }
   */
  loadGroups(): { groups: TempGroup[]; version: number } {
    try {
      // Check if the config file exists
      if (!fs.existsSync(this.configPath)) {
        this.createDefaultConfig();
        return { groups: [], version: this.lastModified };
      }

      const stats = fs.statSync(this.configPath);

      // Cache hit: return a deep clone to prevent callers from mutating the cache
      if (this.cachedGroups && stats.mtimeMs === this.lastModified) {
        return { groups: structuredClone(this.cachedGroups), version: this.lastModified };
      }

      // Read and parse the config file
      const content = fs.readFileSync(this.configPath, 'utf8');
      const parsed: unknown = JSON.parse(content);

      // Config must be an array; anything else (object, string, number, null)
      // is treated the same as unparsable JSON to avoid corrupting callers
      // that assume an array (e.g. .find/.filter).
      if (!Array.isArray(parsed)) {
        this.handleCorruptedConfig();
        return { groups: [], version: this.lastModified };
      }

      const groups = parsed as TempGroup[];

      // Update cache
      this.cachedGroups = groups;
      this.lastModified = stats.mtimeMs;

      // Return a clone so callers cannot corrupt the cache through shared mutation.
      // Mirrors the structuredClone on the cache-hit path above.
      return { groups: structuredClone(groups), version: stats.mtimeMs };
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.handleCorruptedConfig();
        return { groups: [], version: this.lastModified };
      }
      throw error;
    }
  }

  /**
   * Save groups (optimistic locking).
   * Before writing, compares version against the on-disk mtimeMs:
   *   - Match → write and update cache
   *   - Mismatch → throw OptimisticLockError (caller should reload and retry)
   *
   * @param groups  Array of groups
   * @param version Version number obtained from loadGroups()
   * @throws OptimisticLockError
   */
  saveGroups(groups: TempGroup[], version: number): void {
    try {
      // Ensure .vscode directory exists
      const vscodePath = path.dirname(this.configPath);
      if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath, { recursive: true });
      }

      // Ensure config file exists
      if (!fs.existsSync(this.configPath)) {
        fs.writeFileSync(this.configPath, '[]', 'utf8');
      }

      // Version conflict check: compare on-disk mtime
      const currentMtime = fs.statSync(this.configPath).mtimeMs;
      if (currentMtime !== version) {
        throw new OptimisticLockError();
      }

      // Write config file
      const content = JSON.stringify(groups, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf8');

      // Update cache with a private copy: caching the caller's array by
      // reference would let later in-place edits (made without saving) leak
      // into subsequent cache-hit loadGroups() results.
      this.cachedGroups = structuredClone(groups);
      this.lastModified = fs.statSync(this.configPath).mtimeMs;
    } catch (error) {
      if (error instanceof OptimisticLockError) throw error;
      throw new Error(`Failed to save config file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find a group by ID
   *
   * @param groupId Group ID
   * @returns The group object, or undefined if not found
   */
  findGroupById(groupId: string): TempGroup | undefined {
    const { groups } = this.loadGroups();
    // Flat scan: all groups (including subgroups) live in a single top-level
    // array with parentGroupId references, so recursion is unnecessary.
    return groups.find(g => g.id === groupId);
  }

  /**
   * Create default config (with file locking)
   */
  private createDefaultConfig(): void {
    try {
      const vscodePath = path.dirname(this.configPath);
      if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath, { recursive: true });
      }

      const defaultGroups: TempGroup[] = [];
      const content = JSON.stringify(defaultGroups, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf8');

      this.cachedGroups = defaultGroups;
      const stats = fs.statSync(this.configPath);
      this.lastModified = stats.mtimeMs;
    } catch (error) {
      throw new Error(`Failed to create default config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle a corrupted config file
   */
  private handleCorruptedConfig(): void {
    // Backing up the corrupted file is best-effort: if it fails (read-only
    // dir, disk full, AV lock, etc.) we must still fall back to a default
    // config below, otherwise saveGroups() keeps comparing against the
    // corrupted file's real mtime forever and every save throws
    // OptimisticLockError.
    if (fs.existsSync(this.configPath)) {
      try {
        const backupPath = `${this.configPath}.backup.${Date.now()}`;
        fs.copyFileSync(this.configPath, backupPath);
        console.error(`Config file corrupted, backup created: ${backupPath}`);
      } catch (error) {
        console.error(`Failed to back up corrupted config (continuing without backup): ${error}`);
      }
    }
    this.createDefaultConfig();
  }

  /**
   * Clear cache (for testing or forced reload)
   */
  clearCache(): void {
    this.cachedGroups = null;
    this.lastModified = 0;
  }
}
