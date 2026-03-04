/**
 * VirtualTabs MCP Server Implementation
 *
 * This file is responsible for:
 * - Initializing the low-level MCP Server (supports Logging / Prompts / Resources / Tools Capabilities)
 * - Registering all tools, prompt templates, and documentation resources
 * - Handling tool call requests and routing them to the corresponding Manager
 * - Supporting the MCP Roots protocol for dynamically obtaining the workspace path
 * - Structured MCP Logging (log level can be dynamically set by the client)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
  SetLevelRequestSchema,
  type Root,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { zodToJsonSchema } from './utils/zodToJsonSchema.js';
import { normalizeFilesParam, coerceArgs } from './utils/normalizeParams.js';
import { TempGroup } from './types.js';
import { GroupManager } from './managers/GroupManager.js';
import { FileManager } from './managers/FileManager.js';
import { ProjectExplorer } from './managers/ProjectExplorer.js';
import { BookmarkManager } from './managers/BookmarkManager.js';
import { AutoGrouper } from './managers/AutoGrouper.js';
import { GroupTools } from './tools/groupTools.js';
import { FileTools } from './tools/fileTools.js';
import { ProjectTools } from './tools/projectTools.js';
import { BookmarkTools } from './tools/bookmarkTools.js';
import { AutoGroupTools } from './tools/autoGroupTools.js';

const SERVER_NAME = 'virtualtabs';
const SERVER_VERSION = '0.4.0';

// ── Logging ────────────────────────────────────────────────────────────────────

const LOG_LEVEL_ORDER: LoggingLevel[] = [
  'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
];

// ── Tool definitions (schemas) ─────────────────────────────────────────────────────

const TOOL_DEFS = {
  list_groups: {
    description: 'List all groups and their summary information, including hierarchical structure.',
    schema: {},
  },
  create_group: {
    description: 'Create a new group (can be a top-level group or a subgroup).',
    schema: {
      name: z.string().describe('The name of the new group.'),
      parentGroupId: z.string().optional().describe('Optional ID of the parent group (if not provided, creates a top-level group).'),
      files: z.array(z.string()).optional().describe('Optional array of initial file paths to add.'),
    },
  },
  rename_group: {
    description: 'Rename an existing group.',
    schema: {
      groupId: z.string().describe('The ID of the group to rename.'),
      newName: z.string().describe('The new name for the group.'),
    },
  },
  move_group: {
    description: 'Move a group up or down within its current hierarchy level to change ordering.',
    schema: {
      groupId: z.string().describe('The ID of the group to move.'),
      direction: z.enum(['up', 'down']).describe('Direction to move: "up" or "down".'),
    },
  },
  delete_group: {
    description: 'Delete a specific group and optionally all of its nested subgroups.',
    schema: {
      groupId: z.string().describe('The ID of the group to delete.'),
    },
  },
  add_files_to_group: {
    description: 'Add multiple file paths to a specific group.',
    schema: {
      groupId: z.string().describe('The ID of the target group.'),
      files: z.array(z.string()).describe('Array of absolute or workspace-relative file paths to add.'),
    },
  },
  remove_files_from_group: {
    description: 'Remove one or more files from a specific group.',
    schema: {
      groupId: z.string().describe('The ID of the target group.'),
      files: z.array(z.string()).describe('Array of file paths to remove.'),
    },
  },
  explore_project: {
    description: 'Explore project file structure, supports glob patterns, extensions, and directory filtering.',
    schema: {
      pattern: z.string().optional().describe('Glob pattern (e.g., "**/*.ts") (optional).'),
      extension: z.string().optional().describe('File extension (e.g., "md", "json") (optional).'),
      directory: z.string().optional().describe('Target directory to search in (optional).'),
      maxResults: z.number().optional().describe('Maximum number of results to return. Default is 100 (optional).'),
    },
  },
  read_file: {
    description: 'Read the content of a specified file (maximum 100KB limit).',
    schema: {
      filePath: z.string().describe('The file path (absolute or relative to workspace root).'),
    },
  },
  create_bookmark: {
    description: 'Create a bookmark at a specific line in a file.',
    schema: {
      groupId: z.string().describe('The ID of the group the file belongs to.'),
      filePath: z.string().describe('The file path to add the bookmark to.'),
      line: z.number().describe('The line number (0-based indexing).'),
      label: z.string().describe('A short label for the bookmark.'),
      description: z.string().optional().describe('Detailed description (optional).'),
    },
  },
  delete_bookmark: {
    description: 'Delete an existing bookmark using its ID.',
    schema: {
      bookmarkId: z.string().describe('The unique ID of the bookmark to delete.'),
    },
  },
  list_bookmarks: {
    description: 'List existing bookmarks.',
    schema: {
      groupId: z.string().optional().describe('Filter by group ID (optional, returns all bookmarks if omitted).'),
    },
  },
  set_group_sorting: {
    description: 'Configure how files are sorted within a specific group.',
    schema: {
      groupId: z.string().describe('The target group ID.'),
      sortBy: z.enum(['none', 'name', 'path', 'extension', 'modified']).describe('Sorting criteria.'),
      sortOrder: z.enum(['asc', 'desc']).describe('Sorting direction (asc or desc).'),
    },
  },
  auto_group_by_extension: {
    description: 'Automatically organize files into new subgroups based on their file extensions.',
    schema: {
      groupId: z.string().describe('The target group ID whose files will be organized.'),
    },
  },
  auto_group_by_date: {
    description: 'Automatically organize files into time-based subgroups (e.g., Today, This Week) based on modification date.',
    schema: {
      groupId: z.string().describe('The target group ID whose files will be organized.'),
    },
  },
  validate_json_structure: {
    description: 'Validate a JSON string against the virtualTab.json schema. Use this before any direct file write to confirm the structure is correct. Returns { valid, errors[], warnings[] }.',
    schema: {
      json_content: z.string().describe('The full JSON content to validate (as a string).'),
    },
  },
  append_group_to_json: {
    description: 'Safely append a new group to .vscode/virtualTab.json. Automatically handles: backup creation, duplicate name detection, relative path enforcement, and JSON formatting. Use this instead of directly editing the JSON file when standard MCP tools are unavailable.',
    schema: {
      group_name: z.string().describe('Name of the new group.'),
      files: z.union([z.array(z.string()), z.string()]).describe('Workspace-relative file paths to include (must NOT be absolute paths).'),
      color: z.string().optional().describe('Optional VS Code color theme ID (e.g. "charts.blue").'),
    },
  },
  create_group_by_pattern: {
    description:
      'Create a new group and automatically populate it with files matching a glob pattern. ' +
      'The server scans the workspace itself — the AI does NOT need to pass any file paths. ' +
      'PREFER this tool over the explore_project → create_group → add_files_to_group sequence when grouping by file type or location.',
    schema: {
      groupName: z.string().describe('Name for the new group.'),
      pattern: z.string().describe(
        'Glob pattern for files to include, e.g. "**/*.md", "src/**/*.ts". ' +
        'Follows fast-glob syntax. node_modules / .git / dist / out / build / .vscode are always excluded.'
      ),
      ignorePattern: z.string().optional().describe(
        'Optional additional glob pattern to exclude, e.g. "**/*.test.ts".'
      ),
      color: z.string().optional().describe(
        'Optional VS Code color theme ID (e.g. "charts.blue").'
      ),
      parentGroupId: z.string().optional().describe(
        'Optional ID of the parent group (creates a subgroup if provided).'
      ),
    },
  },
  remove_files_by_pattern: {
    description:
      'Remove files from a specific group whose paths match a glob pattern. ' +
      'The server resolves matches against the group\'s existing file list — the AI does NOT need to list individual paths. ' +
      'PREFER this tool over remove_files_from_group when removing many files at once.',
    schema: {
      groupId: z.string().describe('The ID of the target group.'),
      pattern: z.string().describe(
        'Glob pattern for files to remove, e.g. "**/*.test.ts", "docs/**".'
      ),
    },
  },
};

// ── Prompt definitions ──────────────────────────────────────────────────────────────

const PROMPT_DEFS = [
  {
    name: 'virtualtabs:organize',
    description: 'Guide the AI to organize the current workspace groups. Lists all groups and suggests a clean structure.',
    arguments: [
      {
        name: 'strategy',
        description: 'Grouping strategy to use: "by-feature", "by-type", or "by-layer". Defaults to "by-feature".',
        required: false,
      },
    ],
  },
  {
    name: 'virtualtabs:cleanup',
    description: 'Guide the AI to identify and remove invalid file references (deleted or moved files) from all groups.',
    arguments: [],
  },
];

// ── Resource definitions ────────────────────────────────────────────────────────────

const CONSOLIDATED_RESOURCE = {
  uri: 'virtualtabs://docs/complete',
  name: 'VirtualTabs Complete Reference',
  description: 'The single authoritative reference for VirtualTabs: data schema, safety rules, and workspace organization best practices. Reference this resource to get the full development context in one place.',
  mimeType: 'text/markdown',
};

const SCHEMA_CONTENT = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'VirtualTabs Data',
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      description: 'Array of virtual tab groups',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', description: 'Unique group ID (UUID)' },
          name: { type: 'string', description: 'Display name of the group' },
          builtIn: { type: 'boolean', description: 'If true, this group is protected and cannot be deleted' },
          files: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths in this group' },
          parentGroupId: { type: 'string', description: 'ID of the parent group (if this is a subgroup)' },
          sortBy: { type: 'string', enum: ['none', 'name', 'path', 'extension', 'modified'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          bookmarks: {
            type: 'object',
            description: 'Map of filePath -> bookmark array',
            additionalProperties: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'line', 'label', 'created'],
                properties: {
                  id: { type: 'string' },
                  line: { type: 'number' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                  created: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
}, null, 2);

const CONSOLIDATED_CONTENT = `# VirtualTabs Complete Reference

> The single authoritative reference for VirtualTabs MCP. Read this before performing any operation.

---

## 1. Core Schema

The complete JSON data structure of \`.vscode/virtualTab.json\`:

\`\`\`json
${SCHEMA_CONTENT}
\`\`\`

---

## 2. Safety Rules

**These rules are mandatory. Violating them may corrupt the workspace configuration.**

1. **Never delete built-in groups** — groups with \`builtIn: true\` are protected and must never be removed.
2. **UUID format required** — all group IDs must be UUIDs. Never manually create short or arbitrary IDs.
3. **Read before write** — always read \`virtualTab.json\` before any direct modification to confirm the current structure.
4. **Relative paths only** — use workspace-relative paths when adding files to groups.
5. **Strict workspace boundary** — all file operations must be confined to the current workspace root. If no matching files are found inside the workspace, **immediately inform the user** with "no matching files found". Do NOT search other directories for alternatives.
6. **Do not bypass MCP tools** — never add out-of-workspace file paths by directly editing \`virtualTab.json\`. The boundary validation in MCP tools is an intentional safety mechanism and must not be circumvented.

---

## 3. Group Structure Best Practices

### Feature-oriented grouping (recommended)
\`\`\`
📁 Frontend
  ├── src/components/Header.tsx
  └── src/styles/header.css
📁 Backend
  ├── src/api/routes.ts
  └── src/db/schema.ts
\`\`\`

### Type-oriented grouping
\`\`\`
📁 TypeScript
📁 Tests
📁 Config
\`\`\`

### Layer-oriented grouping
\`\`\`
📁 Presentation Layer
📁 Business Logic
📁 Data Access
\`\`\`

---

## 4. Common Workflows

### ✅ Group files by type or pattern (PREFERRED)
Use \`create_group_by_pattern\` — the server scans automatically, no file paths needed:
\`\`\`
create_group_by_pattern({ groupName: "Markdown Docs", pattern: "**/*.md" })
create_group_by_pattern({ groupName: "Source", pattern: "src/**/*.ts", ignorePattern: "**/*.test.ts" })
\`\`\`

### Remove files by pattern (PREFERRED over listing paths)
\`\`\`
remove_files_by_pattern({ groupId: "...", pattern: "**/*.test.ts" })
\`\`\`

### Organize workspace manually (when pattern-based tools are not suitable)
1. \`list_groups\` — view existing groups
2. \`explore_project\` — explore project structure
3. \`create_group\` — create an empty group
4. \`add_files_to_group\` — add files (**IMPORTANT: max 15 paths per call; batch if more**)

### Clean up invalid references
1. \`list_groups\` — get all groups
2. \`read_file\` — verify each file still exists
3. \`remove_files_from_group\` — remove invalid paths (**max 15 per call**)

## 5. Array Size Limits (CRITICAL)

**When calling tools that accept a \`files\` array (\`add_files_to_group\`, \`remove_files_from_group\`, \`create_group\`, \`append_group_to_json\`), NEVER pass more than 15 file paths in a single call.**

If you have more than 15 files:
- **Option A (recommended):** Use \`create_group_by_pattern\` or \`remove_files_by_pattern\` instead.
- **Option B:** Split the array and make multiple calls of ≤ 15 items each.

Passing large arrays in a single call risks JSON truncation and will result in \`undefined\` parameter errors.
`;

// ── VirtualTabsMCPServer ───────────────────────────────────────────────────────

export class VirtualTabsMCPServer {
  private server: Server;
  private workspaceRoot?: string;
  private currentLogLevel?: LoggingLevel = process.env.VIRTUALTABS_MCP_DEBUG ? 'debug' : undefined;

  // Managers
  private groupManager?: GroupManager;
  private fileManager?: FileManager;
  private projectExplorer?: ProjectExplorer;
  private bookmarkManager?: BookmarkManager;
  private autoGrouper?: AutoGrouper;

  // Tools
  private groupTools?: GroupTools;
  private fileTools?: FileTools;
  private projectTools?: ProjectTools;
  private bookmarkTools?: BookmarkTools;
  private autoGroupTools?: AutoGroupTools;

  constructor(workspaceRoot?: string) {
    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: false },
          resources: {},
          logging: {},
        },
      },
    );

    if (workspaceRoot) {
      this.updateWorkspaceRoot(workspaceRoot);
    }

    this.registerHandlers();
  }

  // ── Logging ──────────────────────────────────────────────────────────────────

  private shouldLog(level: LoggingLevel): boolean {
    if (!this.currentLogLevel) return false;
    return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(this.currentLogLevel);
  }

  private log(level: LoggingLevel, message: string, data?: unknown): void {
    // Write to stderr only when log level is enabled (controlled by VIRTUALTABS_MCP_DEBUG)
    if (this.shouldLog(level)) {
      console.error(`[${level.toUpperCase()}] ${message}`, data !== undefined ? data : '');
      void this.server.sendLoggingMessage({ level, data: data !== undefined ? { message, data } : { message } });
    }
  }

  // ── Workspace ─────────────────────────────────────────────────────────────────

  private updateWorkspaceRoot(newWorkspaceRoot: string): void {
    this.workspaceRoot = path.resolve(newWorkspaceRoot);

    this.groupManager = new GroupManager(this.workspaceRoot);
    this.fileManager = new FileManager(this.workspaceRoot, this.groupManager);
    this.projectExplorer = new ProjectExplorer(this.workspaceRoot);
    this.bookmarkManager = new BookmarkManager(this.groupManager, this.fileManager);
    this.autoGrouper = new AutoGrouper(this.groupManager, this.fileManager);

    this.groupTools = new GroupTools(this.groupManager, this.fileManager);
    this.fileTools = new FileTools(this.fileManager);
    this.projectTools = new ProjectTools(this.projectExplorer);
    this.bookmarkTools = new BookmarkTools(this.bookmarkManager);
    this.autoGroupTools = new AutoGroupTools(
      this.autoGrouper,
      this.projectExplorer,
      this.groupManager,
      this.fileManager,
    );

    this.log('info', `Workspace root updated: ${this.workspaceRoot}`);
  }

  private async updateWorkspaceFromRoots(roots: Root[]): Promise<void> {
    if (!roots || roots.length === 0) {
      this.log('warning', 'Client did not provide any roots');
      return;
    }

    const firstRoot = roots[0];
    let rootPath = firstRoot.uri;

    if (rootPath.startsWith('file://')) {
      rootPath = rootPath.slice(7);
      if (rootPath.startsWith('/') && rootPath.charAt(2) === ':') {
        rootPath = rootPath.slice(1);
      }
    }

    try {
      const stats = await fs.promises.stat(rootPath);
      if (stats.isDirectory()) {
        this.updateWorkspaceRoot(rootPath);
        this.log('info', `Workspace set from MCP Roots: ${rootPath}`);
      } else {
        this.log('warning', `Root path is not a directory: ${rootPath}`);
      }
    } catch (error) {
      this.log('error', `Cannot access root path ${rootPath}`, error instanceof Error ? error.message : String(error));
    }
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  getGroupManager(): GroupManager | undefined {
    return this.groupManager;
  }

  // ── Tool call wrapper ─────────────────────────────────────────────────────────

  private async wrap<T>(fn: () => Promise<T>) {
    if (!this.workspaceRoot) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: {
              type: 'not_initialized',
              message: 'Workspace not initialized. Please ensure the client supports the MCP Roots protocol, or specify a workspace path via command-line arguments.',
            },
          }, null, 2),
        }],
        isError: true,
      };
    }
    try {
      const result = await fn();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: {
              type: 'internal_error',
              message: error instanceof Error ? error.message : String(error),
            },
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Parse and validate tool arguments through the tool's Zod schema.
   * Pre-coerces string values to numbers/arrays for MCP clients (e.g. Kiro)
   * that serialise all arguments as strings.
   */
  private parseArgs<S extends z.ZodRawShape>(schema: S, args: unknown): z.infer<z.ZodObject<S>> {
    const coerced = coerceArgs((args ?? {}) as Record<string, unknown>, schema as Record<string, unknown>);
    return z.object(schema).parse(coerced);
  }

  // ── Register all MCP handlers ─────────────────────────────────────────────────

  private registerHandlers(): void {
    // 1. Logging level
    this.server.setRequestHandler(SetLevelRequestSchema, async ({ params }) => {
      this.currentLogLevel = params.level;
      this.log('info', `Log level set to: ${params.level}`);
      return {};
    });

    // 2. Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(TOOL_DEFS).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: zodToJsonSchema(def.schema),
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      this.log('debug', `call_tool: ${name}`, args);
      switch (name) {
        case 'list_groups': return this.wrap(() => this.groupTools!.listGroups());
        case 'create_group': return this.wrap(() => this.groupTools!.createGroup(this.parseArgs(TOOL_DEFS.create_group.schema, args)));
        case 'rename_group': return this.wrap(() => this.groupTools!.renameGroup(this.parseArgs(TOOL_DEFS.rename_group.schema, args)));
        case 'move_group': return this.wrap(() => this.groupTools!.moveGroup(this.parseArgs(TOOL_DEFS.move_group.schema, args)));
        case 'delete_group': return this.wrap(() => this.groupTools!.deleteGroup(this.parseArgs(TOOL_DEFS.delete_group.schema, args)));
        case 'add_files_to_group': return this.wrap(() => this.fileTools!.addFilesToGroup(this.parseArgs(TOOL_DEFS.add_files_to_group.schema, args)));
        case 'remove_files_from_group': return this.wrap(() => this.fileTools!.removeFilesFromGroup(this.parseArgs(TOOL_DEFS.remove_files_from_group.schema, args)));
        case 'explore_project': return this.wrap(() => this.projectTools!.exploreProject(this.parseArgs(TOOL_DEFS.explore_project.schema, args)));
        case 'read_file': return this.wrap(() => this.projectTools!.readFile(this.parseArgs(TOOL_DEFS.read_file.schema, args)));
        case 'create_bookmark': return this.wrap(() => this.bookmarkTools!.createBookmark(this.parseArgs(TOOL_DEFS.create_bookmark.schema, args)));
        case 'delete_bookmark': return this.wrap(() => this.bookmarkTools!.deleteBookmark(this.parseArgs(TOOL_DEFS.delete_bookmark.schema, args)));
        case 'list_bookmarks': return this.wrap(() => this.bookmarkTools!.listBookmarks(this.parseArgs(TOOL_DEFS.list_bookmarks.schema, args)));
        case 'set_group_sorting': return this.wrap(() => this.autoGroupTools!.setGroupSorting(this.parseArgs(TOOL_DEFS.set_group_sorting.schema, args)));
        case 'auto_group_by_extension': return this.wrap(() => this.autoGroupTools!.autoGroupByExtension(this.parseArgs(TOOL_DEFS.auto_group_by_extension.schema, args)));
        case 'auto_group_by_date': return this.wrap(() => this.autoGroupTools!.autoGroupByDate(this.parseArgs(TOOL_DEFS.auto_group_by_date.schema, args)));
        case 'create_group_by_pattern': return this.wrap(() => this.autoGroupTools!.createGroupByPattern(this.parseArgs(TOOL_DEFS.create_group_by_pattern.schema, args)));
        case 'remove_files_by_pattern': return this.wrap(() => this.autoGroupTools!.removeFilesByPattern(this.parseArgs(TOOL_DEFS.remove_files_by_pattern.schema, args)));

        case 'validate_json_structure': {
          const { json_content } = this.parseArgs(TOOL_DEFS.validate_json_structure.schema, args);
          const errors: string[] = [];
          const warnings: string[] = [];
          try {
            const parsed = JSON.parse(json_content);
            // virtualTab.json uses a bare array format: [...]
            if (!Array.isArray(parsed)) {
              errors.push('Root must be a JSON array (e.g. [...]).');
            } else {
              const seenIds = new Set<string>();
              for (let i = 0; i < parsed.length; i++) {
                const g = parsed[i];
                if (!g.id) { errors.push(`Group[${i}] missing "id".`); }
                else if (seenIds.has(g.id)) { errors.push(`Duplicate id "${g.id}" at index ${i}.`); }
                else { seenIds.add(g.id); }
                if (!g.name) { errors.push(`Group[${i}] missing "name".`); }
                if (g.files !== undefined && !Array.isArray(g.files)) {
                  errors.push(`Group "${g.name ?? i}" has invalid "files" (expected array or undefined).`);
                } else {
                  for (const f of g.files) {
                    if (path.isAbsolute(f)) {
                      errors.push(`Group "${g.name}": absolute path detected: "${f}". Must be workspace-relative.`);
                    }
                  }
                }
                if (g.builtIn === true) {
                  warnings.push(`Group "${g.name}" has builtIn=true — do NOT edit or delete this group.`);
                }
              }
            }
          } catch (e) {
            errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
          }
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ valid: errors.length === 0, errors, warnings }, null, 2),
            }],
          };
        }

        case 'append_group_to_json': {
          if (!this.workspaceRoot) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Workspace not initialized.' }) }],
              isError: true,
            };
          }
          const { group_name, files, color } = this.parseArgs(TOOL_DEFS.append_group_to_json.schema, args);
          const filesArray = normalizeFilesParam(files);

          const jsonPath = path.join(this.workspaceRoot, '.vscode', 'virtualTab.json');
          const backupPath = jsonPath + '.backup';
          try {
            if (!group_name?.trim()) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'group_name is required and cannot be empty.' }) }],
                isError: true,
              };
            }
            if (!Array.isArray(filesArray) || filesArray.length === 0) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'files must be a non-empty array.' }) }],
                isError: true,
              };
            }
            const absoluteFiles = filesArray.filter(f => path.isAbsolute(f));
            if (absoluteFiles.length > 0) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `File paths must be workspace-relative. Absolute paths detected: ${absoluteFiles.join(', ')}` }) }],
                isError: true,
              };
            }
            const raw = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf-8') : '[]';
            const data = JSON.parse(raw);
            // virtualTab.json uses a bare array format: [...]
            if (!Array.isArray(data)) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Invalid virtualTab.json: root must be a JSON array.' }) }],
                isError: true,
              };
            }
            if ((data as TempGroup[]).some(g => g.name === group_name)) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `A group named "${group_name}" already exists.` }) }],
                isError: true,
              };
            }
            // Create backup before writing
            fs.writeFileSync(backupPath, raw, 'utf-8');
            const newGroup: TempGroup = {
              id: `group-${Date.now()}`,
              name: group_name,
              files: filesArray,
              bookmarks: {},
            };
            if (color) { newGroup.color = color; }
            data.push(newGroup);
            fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  message: `Group "${group_name}" added with ${filesArray.length} file(s). Backup saved to ${path.relative(this.workspaceRoot, backupPath).replace(/\\/g, '/')}.`,
                  groupId: newGroup.id,
                }, null, 2),
              }],
            };
          } catch (e) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }) }],
              isError: true,
            };
          }
        }

        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }
    });

    // 3. Prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: PROMPT_DEFS,
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      switch (name) {
        case 'virtualtabs:organize': {
          const strategy = args?.strategy ?? 'by-feature';
          return {
            description: PROMPT_DEFS[0].description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: [
                    `Please organize the VirtualTabs workspace using the "${strategy}" strategy.`,
                    '',
                    'Steps to follow:',
                    '1. Call `list_groups` to see the current group structure.',
                    '2. Call `explore_project` to understand the project layout.',
                    '3. Propose a clean group structure based on the chosen strategy.',
                    '4. Create new groups and move files accordingly.',
                    '5. Remove empty or redundant groups.',
                  ].join('\n'),
                },
              },
            ],
          };
        }
        case 'virtualtabs:cleanup': {
          return {
            description: PROMPT_DEFS[1].description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: [
                    'Please clean up invalid file references in VirtualTabs.',
                    '',
                    'Steps to follow:',
                    '1. Call `list_groups` to retrieve all groups and their file lists.',
                    '2. For each file path, verify it exists using `read_file` or file existence checks.',
                    '3. Collect all paths that no longer exist.',
                    '4. Call `remove_files_from_group` to remove invalid references.',
                    '5. Report a summary of what was cleaned up.',
                  ].join('\n'),
                },
              },
            ],
          };
        }
        default:
          throw new Error(`Unknown Prompt: ${name}`);
      }
    });

    // 4. Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [CONSOLIDATED_RESOURCE],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const { uri } = req.params;
      switch (uri) {
        case 'virtualtabs://docs/complete':
          return {
            contents: [{
              uri,
              mimeType: CONSOLIDATED_RESOURCE.mimeType,
              text: CONSOLIDATED_CONTENT,
            }],
          };
        default:
          throw new Error(`Unknown Resource URI: ${uri}`);
      }
    });

    // 5. Roots protocol (listen for workspace path changes)
    this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      try {
        this.log('debug', 'Received roots/list_changed notification, requesting updated roots...');
        const response = await this.server.listRoots();
        if (response && 'roots' in response) {
          await this.updateWorkspaceFromRoots(response.roots);
        }
      } catch (error) {
        this.log('error', 'Failed to get roots from client', error instanceof Error ? error.message : String(error));
      }
    });
  }

  // ── Connect ──────────────────────────────────────────────────────────────────

  async connect(transport: Transport): Promise<void> {
    // Attempt to discover the workspace immediately after initialization
    this.server.oninitialized = async () => {
      const clientCapabilities = this.server.getClientCapabilities();
      const clientVersion = this.server.getClientVersion();
      this.log('info', `Client connected: ${clientVersion?.name ?? '<unknown>'} ${clientVersion?.version ?? ''}`);

      if (clientCapabilities?.roots) {
        try {
          this.log('debug', 'Client supports MCP Roots, requesting workspace path...');
          const response = await this.server.listRoots();
          if (response && 'roots' in response) {
            await this.updateWorkspaceFromRoots(response.roots);
          } else {
            this.log('warning', 'Client did not provide roots');
          }
        } catch (error) {
          this.log('error', 'Failed to get initial roots from client', error instanceof Error ? error.message : String(error));
          if (!this.workspaceRoot) {
            this.log('error', 'Warning: no workspace path — MCP tools will not be available');
          }
        }
      } else {
        this.log('notice', 'Client does not support MCP Roots protocol');
        if (!this.workspaceRoot) {
          this.log('error', 'Error: cannot obtain workspace path. Please specify one via command-line arguments, or use a client that supports MCP Roots.');
        } else {
          this.log('info', `Using command-line specified workspace: ${this.workspaceRoot}`);
        }
      }
    };

    await this.server.connect(transport);
  }
}
