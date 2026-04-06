# Praxl — AI Skill Manager CLI

[![npm version](https://img.shields.io/npm/v/praxl-app)](https://www.npmjs.com/package/praxl-app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**One source of truth for all your AI skills.** Praxl discovers, syncs, and deploys SKILL.md files across Claude Code, Cursor, Codex, Copilot, Gemini CLI, Windsurf, OpenCode, and Claude.ai.

Stop copy-pasting skills between AI tools. Edit once — synced everywhere.

```bash
npm install -g praxl-app
praxl scan
```

## Why Praxl?

If you use more than one AI coding tool, your skills are scattered:

- Same skill in 5 directories, each slightly different
- No way to know which version is current
- Improving a skill means updating it in every tool manually
- No version history — one bad edit and it's gone

Praxl fixes this. Scan → Import → Edit → Sync. One command.

## Quick Start

```bash
# 1. Install
npm install -g praxl-app

# 2. Scan — discover all existing skills on your machine
praxl scan

# 3. Connect — import to cloud + start syncing
praxl connect

# That's it. Edit in Praxl or locally — stays in sync.
```

## Commands

### `praxl scan`

Discovers all SKILL.md files across your AI tool directories. No account needed.

```bash
$ praxl scan
Found 38 skills across 3 tools. 14 duplicates. 6 outdated.

  Claude Code    ~/.claude/commands/     18 skills
  Cursor         ~/.cursor/rules/        12 skills
  Codex          ~/.codex/skills/         8 skills
```

Includes offline quality scoring (0–5 scale) and security scanning for each skill.

### `praxl connect`

One-step setup: authenticates, imports all discovered skills to Praxl, deduplicates, and starts watching for changes.

```bash
$ praxl connect
✓ Authenticated as you@email.com
✓ Imported 38 skills
✓ Deduped 14 → kept newest versions
✓ Watching for changes...
```

### `praxl sync`

Downloads skills from Praxl to your local tool directories.

```bash
praxl sync                    # Sync once
praxl sync --watch            # Watch mode — polls every 30s
praxl sync --daemon           # Background daemon
praxl sync --platforms cursor,codex  # Sync specific platforms only
```

### `praxl import`

Upload local skills to your Praxl account — including reference files (scripts, templates, assets).

```bash
praxl import                      # Import from default paths
praxl import --path ~/my-skills   # Import from custom directory
```

### `praxl status`

Show your account info and skill list.

```bash
$ praxl status
  Authenticated as you@email.com (Pro)
  Skills: 42 (38 active, 4 archived)

  code-review.md          v3   12.4 KB  active
  test-writer.md          v2    8.1 KB  active
  bug-fixer.md            v5   15.2 KB  active
  ...
```

### `praxl login`

Save your auth token manually (alternative to `praxl connect`).

```bash
praxl login --token YOUR_TOKEN
```

Get your token from [Settings → CLI Token](https://go.praxl.app/settings).

## Supported Platforms

| Platform | Directory | Status |
|----------|-----------|--------|
| Claude Code | `~/.claude/commands/` | Full sync |
| Cursor | `~/.cursor/rules/` | Full sync |
| Codex CLI | `~/.codex/skills/` | Full sync |
| GitHub Copilot | `~/.github/copilot/` | Full sync |
| Windsurf | `~/.windsurf/skills/` | Full sync |
| OpenCode | `~/.opencode/skills/` | Full sync |
| Gemini CLI | `~/.gemini/skills/` | Full sync |
| Claude.ai | via Praxl web app | Cloud sync |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--token` | saved in `~/.praxl/token` | Auth token from Praxl Settings |
| `--url` | `https://go.praxl.app` | Praxl instance URL |
| `--platforms` | all configured | Comma-separated platform list |
| `--path` | auto-detected | Directory for import |
| `--interval` | `30` | Poll interval in seconds (watch/daemon) |
| `--json` | `false` | Output as JSON (scan command) |

## What is a SKILL.md?

A SKILL.md file is a structured Markdown document that teaches an AI coding tool how to perform a specific task. It includes:

- **Metadata** (YAML frontmatter): name, description, version, tags
- **Instructions**: step-by-step guide for the AI
- **Examples**: input/output pairs showing expected behavior
- **Triggers**: phrases that activate the skill automatically

Example:

```markdown
---
name: code-review
description: Reviews code for bugs, style, and security issues
version: 1.0.0
tags: [review, quality]
---

# Code Review

When asked to review code, follow this process:

1. Read the entire file before commenting
2. Check for bugs, security issues, and style violations
3. Suggest specific fixes with code examples
...
```

Praxl manages these files for you — versioning, syncing, and deploying across tools.

## Features

- **Auto-discovery**: `praxl scan` finds skills in all known AI tool directories
- **Deduplication**: detects and merges duplicate skills across tools
- **Quality scoring**: offline 0–5 score based on frontmatter, structure, examples
- **Security scanning**: flags hardcoded credentials, shell injection, unsafe patterns
- **Bidirectional sync**: edit locally → pushed to cloud, edit in app → lands on disk
- **Background daemon**: `praxl sync --daemon` keeps everything synced quietly
- **Reference files**: imports scripts, templates, and assets alongside skills

## Web App

The Praxl web app at [go.praxl.app](https://go.praxl.app) provides:

- Monaco editor with syntax highlighting and AI review
- Version history with diffs and rollback
- Team organizations and shared skills
- Community marketplace
- Analytics dashboard

The CLI syncs bidirectionally with the web app. Use whichever you prefer — or both.

## Links

- **Website**: [praxl.app](https://praxl.app)
- **Web App**: [go.praxl.app](https://go.praxl.app)
- **Documentation**: [praxl.app/docs](https://praxl.app/docs)
- **Privacy Policy**: [go.praxl.app/privacy](https://go.praxl.app/privacy)
- **Contact**: hello@praxl.app

## License

MIT
