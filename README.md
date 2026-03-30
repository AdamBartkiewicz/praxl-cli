# Praxl CLI

Sync AI skills from [Praxl](https://praxl.app) to your local tools — Claude Code, Cursor, Codex, and more.

## Quick Start

```bash
# Login (one-time)
npx praxl login

# Sync skills to ~/.claude/skills/
npx praxl sync

# Watch mode (auto-sync every 30s)
npx praxl sync --watch

# Import local skills to Praxl
npx praxl import
```

## Commands

| Command | Description |
|---------|-------------|
| `praxl login` | Save your auth token |
| `praxl sync` | Download all skills to local folders |
| `praxl sync --watch` | Watch mode — polls for changes |
| `praxl sync --daemon` | Background sync daemon |
| `praxl import` | Upload local skills to Praxl |
| `praxl status` | Show your skills |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--token TOKEN` | saved | Auth token from Praxl Settings |
| `--url URL` | `https://go.praxl.app` | Praxl instance URL |
| `--platforms a,b` | `claude-code` | Target platforms to sync |
| `--path DIR` | `~/.claude/skills` | Directory for import |
| `--interval SEC` | `30` | Poll interval for watch/daemon |

## Supported Platforms

- `claude-code` → `~/.claude/skills/`
- `cursor` → `~/.cursor/skills/`
- `codex` → `~/.agents/skills/`
- `copilot` → `~/.agents/skills/`
- `windsurf` → `~/.windsurf/skills/`
- `opencode` → `~/.opencode/skills/`
- `gemini-cli` → `~/.claude/skills/`

## Get Your Token

1. Go to [go.praxl.app/settings](https://go.praxl.app/settings)
2. Find "CLI Token" section
3. Click "Reveal CLI Token"
4. Copy and use with `npx praxl login --token YOUR_TOKEN`
