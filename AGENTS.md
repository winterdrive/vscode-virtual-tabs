# Repository Agent Instructions

- Before answering or changing the repository, inspect related implementation, documentation, open work, and prior decisions. Do not rely on conversation context alone.
- Keep changes narrow and preserve unrelated worktree changes.

## Authoritative Documentation Map

Use this file as a routing entry point. Do not copy detailed procedures into
`AGENTS.md`; read the authoritative source required for the current task.

Each normative topic has exactly one canonical source. Other documents must
link to that source instead of restating changeable rules, counts, paths, or
procedures. A short product summary is acceptable when it contains no mutable
operational detail. Localized documents are synchronized translations, not
independent authorities; follow the translation policy in `I18N.md`.
If a standalone consumer artifact must embed instructions to work without the
repository, identify the canonical source beside the excerpt and update both
in the same change.

| Task | Required source |
|---|---|
| Product overview and end-user usage | `README.md` |
| Release planning, version channels, contributor fast lane, release authorization | `docs/RELEASE_POLICY.md` |
| Build, local development, extension architecture, local packaging | `DEVELOPMENT.md` |
| Current automated and UI/E2E test procedures | `docs/TESTING.md` |
| Repository language, contribution, and pull-request expectations | `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` |
| MCP client setup | `docs/mcp-setup.md` |
| MCP server architecture, current capabilities, build, and startup | `mcp-server/README.md` |
| Agent Skill behavior and safety workflow | `skills/virtualtabs/SKILL.md` |
| Localization and documentation translation policy | `I18N.md` and the existing locale files |
| Product philosophy | `docs/PHILOSOPHY.md` |
| LLM discovery index and generated full context | `docs/llms.txt` and `scripts/generate-llms-full.mjs` |
| Shipped behavior and release history | `CHANGELOG.md` |

For any release-related task, read `docs/RELEASE_POLICY.md` in full before
planning or taking action.
