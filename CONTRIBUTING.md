# 🤝 Contributing Guide

Thank you for your interest in VirtualTabs (editorGrouper)! We welcome all forms of contribution, whether it's fixing bugs, developing new features, or improving documentation.

## Repository Language

Use English for tracked repository documentation, code comments, and public
GitHub-facing content such as issues and pull requests, unless you are editing
an explicitly localized file. Follow the canonical-source ownership map in
[`AGENTS.md`](./AGENTS.md); do not copy mutable rules, counts, paths, or
procedures into a second document.

## 🤖 AI-Assisted Development Guide for Contributors

If you use AI tools (such as Cursor, Copilot, ChatGPT, or Claude) to assist with your development, we have prepared a specific prompt for you.
Before writing code or submitting a Pull Request (PR), **we highly recommend pasting the following prompt to your AI assistant**. This will significantly improve your development experience and the chances of your PR being merged quickly.

### 📝 AI Prompt (Copy and paste to your AI)

<details>
<summary>Click to expand AI Developer Prompt</summary>

```text
You are now a senior contributor to the VirtualTabs project. When I develop/modify code and prepare a PR, please strictly adhere to the following guidelines:

1. **Development Rules**:
   - The project is a VS Code Extension based on TypeScript.
   - Read `AGENTS.md` and the authoritative document it identifies for your task before making changes.
   - When adding new features, ensure they comply with the settings in `package.json` and the i18n specifications in `package.nls.json`.
   
2. **Commit Message Format**:
   - Please follow the Conventional Commits specification (feat, fix, docs, chore, etc.).
   - Example: `feat(core): add new group management feature`

3. **Pull Request Description Generation**:
   - When I finish coding and ask you to formulate a PR description, you must generate it according to the structure defined in `.github/PULL_REQUEST_TEMPLATE.md`.
   - The content must explicitly state "what problem is solved", "which core files were modified", and "how to manually test this feature".
```

</details>

---

## 🛠 Development Workflow

1. **Fork this repository** and clone it to your local machine.
2. **Create a new development branch** (e.g., `feature/my-new-feature` or `bugfix/issue-123`).
3. Refer to [`DEVELOPMENT.md`](./DEVELOPMENT.md) for local environment setup and architecture understanding.
4. Commit your changes following our commit conventions.
5. Push the branch and create a Pull Request.

## 📝 Code Style

- Use TypeScript strict mode.
- Follow existing naming conventions.
- Use JSDoc comments appropriately for main functions and classes.

## ✅ Testing

Use [`docs/TESTING.md`](./docs/TESTING.md) as the canonical source for current
automated suites, UI/E2E constraints, commands, and known limitations. Record
the applicable automated and manual validation in the pull-request template.

If you have any questions about the architecture or design, feel free to open an Issue to discuss!
