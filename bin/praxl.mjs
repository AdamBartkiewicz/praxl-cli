#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

const VERSION = "1.0.0";
const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".praxl");
const TOKEN_FILE = path.join(CONFIG_DIR, "token");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const STATE_FILE = path.join(CONFIG_DIR, "sync-state.json");
const LOG_FILE = path.join(CONFIG_DIR, "sync.log");
const PID_FILE = path.join(CONFIG_DIR, "sync.pid");

const DEFAULT_URL = "https://go.praxl.app";

const PLATFORM_PATHS = {
  "claude-code": path.join(HOME, ".claude/skills"),
  "cursor": path.join(HOME, ".cursor/skills"),
  "codex": path.join(HOME, ".agents/skills"),
  "copilot": path.join(HOME, ".agents/skills"),
  "windsurf": path.join(HOME, ".windsurf/skills"),
  "opencode": path.join(HOME, ".opencode/skills"),
  "gemini-cli": path.join(HOME, ".claude/skills"),
};

// ─── Config helpers ─────────────────────────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getToken() {
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  const config = loadConfig();
  return config.token || null;
}

function saveToken(token) {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_FILE, token);
}

function getUrl() {
  const config = loadConfig();
  return config.url || DEFAULT_URL;
}

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

// ─── API helpers ────────────────────────────────────────────────────────────

async function api(endpoint, token, url, options = {}) {
  const res = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: { "x-praxl-token": token, "Content-Type": "application/json", ...options.headers },
  });
  return res;
}

async function verifyToken(token, url) {
  const res = await api("/api/cli/import", token, url);
  if (!res.ok) return null;
  return res.json();
}

// ─── Write skill to disk ────────────────────────────────────────────────────

function writeSkill(baseDir, slug, content, files = []) {
  try {
    const dir = path.join(baseDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf-8");
    for (const f of files) {
      const sub = path.join(dir, f.folder);
      fs.mkdirSync(sub, { recursive: true });
      if (f.mimeType?.startsWith("text/") || f.mimeType === "application/json") {
        fs.writeFileSync(path.join(sub, f.filename), f.content, "utf-8");
      } else {
        fs.writeFileSync(path.join(sub, f.filename), Buffer.from(f.content, "base64"));
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Scan local skills ─────────────────────────────────────────────────────

function scanLocalSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, "SKILL.md"))).map(slug => {
    const content = fs.readFileSync(path.join(dir, slug, "SKILL.md"), "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const descMatch = fmMatch?.[1]?.match(/^description:\s*(.+)$/m);
    const description = descMatch?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
    const name = slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const files = [];
    for (const folder of ["references", "scripts", "assets"]) {
      const sub = path.join(dir, slug, folder);
      if (!fs.existsSync(sub)) continue;
      for (const fn of fs.readdirSync(sub)) {
        if (!fs.statSync(path.join(sub, fn)).isFile()) continue;
        files.push({ folder, filename: fn, content: fs.readFileSync(path.join(sub, fn), "utf-8"), mimeType: "text/plain", size: fs.statSync(path.join(sub, fn)).size });
      }
    }
    return { slug, name, description: description.slice(0, 500), content, files };
  });
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdLogin(args) {
  const url = args.url || getUrl();
  console.log("\n  Praxl — Login\n");

  let token = args.token;
  if (!token) {
    console.log(`  Get your CLI token from: ${url}/settings\n`);
    token = await prompt("  Paste your token: ");
  }
  if (!token) { console.log("  ✗ Token required.\n"); process.exit(1); }

  console.log("  Verifying...");
  const data = await verifyToken(token, url);
  if (!data) { console.log("  ✗ Invalid token.\n"); process.exit(1); }

  saveToken(token);
  saveConfig({ ...loadConfig(), url });
  console.log(`  ✓ Logged in as ${data.user?.name || data.user?.email}`);
  console.log(`  Token saved to ${TOKEN_FILE}\n`);
}

async function cmdSync(args) {
  const token = args.token || getToken();
  const url = args.url || getUrl();
  const platforms = (args.platforms || "claude-code").split(",");
  const interval = parseInt(args.interval) || 30;
  const mode = args.watch ? "watch" : args.daemon ? "daemon" : "once";

  if (!token) { console.log("\n  ✗ Not logged in. Run: npx praxl login\n"); process.exit(1); }

  const isDaemon = mode === "daemon";
  const log = (msg) => {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    if (isDaemon) fs.appendFileSync(LOG_FILE, line + "\n");
    else console.log(`  ${line}`);
  };

  if (!isDaemon) {
    console.log(`\n  ╔═══════════════════════════════════════╗`);
    console.log(`  ║  Praxl Sync${mode === "watch" ? " (watching)" : ""}                        ║`);
    console.log(`  ╚═══════════════════════════════════════╝\n`);
  }

  // Verify
  const data = await verifyToken(token, url);
  if (!data) { log("✗ Invalid token. Run: npx praxl login"); process.exit(1); }
  log(`Authenticated as ${data.user?.name || data.user?.email}`);

  // Fetch platform config from Praxl (unless --platforms was explicitly passed)
  let syncPlatforms = platforms;
  if (!args.platforms) {
    try {
      const configRes = await api("/api/cli/config", token, url);
      if (configRes.ok) {
        const config = await configRes.json();
        const activeTargets = config.targets?.filter(t => t.isActive) || [];
        if (activeTargets.length > 0) {
          syncPlatforms = activeTargets.map(t => t.platform);
          log(`Platforms from config: ${activeTargets.map(t => `${t.label} (${t.basePath})`).join(", ")}`);
          // Override PLATFORM_PATHS with custom paths from config
          for (const t of activeTargets) {
            if (t.basePath) PLATFORM_PATHS[t.platform] = t.basePath.replace(/^~/, HOME);
          }
        }
      }
    } catch {}
  }
  log(`Targets: ${syncPlatforms.join(", ")}`);

  async function doSync(incremental = false) {
    const since = incremental ? (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")).lastSync; } catch { return null; } })() : null;
    const endpoint = `/api/cli/sync${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const res = await api(endpoint, token, url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    let synced = 0;
    for (const skill of result.skills) {
      if (!skill.isActive) continue;
      for (const platform of syncPlatforms) {
        const base = PLATFORM_PATHS[platform] || path.join(HOME, `.${platform}/skills`);
        if (writeSkill(base, skill.slug, skill.content, skill.files)) synced++;
      }
    }
    ensureConfigDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: result.syncedAt }));
    return { synced, total: result.skills.length };
  }

  if (mode === "once") {
    log("Syncing all skills...");
    const r = await doSync(false);
    log(`✓ Done: ${r.synced} files written (${r.total} skills)\n`);
    process.exit(0);
  }

  // Watch/daemon
  if (isDaemon) {
    ensureConfigDir();
    fs.writeFileSync(PID_FILE, String(process.pid));
    log(`Daemon started (PID: ${process.pid})`);
  } else {
    log(`Polling every ${interval}s — Ctrl+C to stop\n`);
  }

  // Send heartbeat
  async function sendHeartbeat(skillCount = 0) {
    try {
      const res = await api("/api/cli/heartbeat", token, url, {
        method: "POST",
        body: JSON.stringify({
          platforms: syncPlatforms,
          hostname: os.hostname(),
          mode,
          skillCount,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Check if web app triggered a sync
        if (data.command?.action === "sync") {
          log("⚡ Sync triggered from web app");
          const r = await doSync(false);
          log(`✓ Synced ${r.synced} files (${r.total} skills)`);
        }
      }
    } catch {}
  }

  // Initial full sync
  let lastSkillCount = 0;
  try {
    const r = await doSync(false);
    lastSkillCount = r.total;
    log(`Initial: ${r.synced} files (${r.total} skills)`);
    await sendHeartbeat(r.total);
  } catch (e) { log(`✗ ${e.message}`); }

  // Poll + heartbeat
  setInterval(async () => {
    try {
      await sendHeartbeat(lastSkillCount);
      const r = await doSync(true);
      if (r.total > 0) {
        log(`↻ Updated ${r.synced} files (${r.total} changed)`);
        lastSkillCount += r.total;
      }
    } catch (e) { log(`✗ ${e.message}`); }
  }, interval * 1000);
}

async function cmdImport(args) {
  const token = args.token || getToken();
  const url = args.url || getUrl();
  const skillsDir = args.path || path.join(HOME, ".claude/skills");

  if (!token) { console.log("\n  ✗ Not logged in. Run: npx praxl login\n"); process.exit(1); }

  console.log(`\n  ╔═══════════════════════════════════════╗`);
  console.log(`  ║  Praxl Import                          ║`);
  console.log(`  ╚═══════════════════════════════════════╝\n`);

  const data = await verifyToken(token, url);
  if (!data) { console.log("  ✗ Invalid token.\n"); process.exit(1); }
  console.log(`  User: ${data.user?.name || data.user?.email}`);
  console.log(`  Path: ${skillsDir}`);

  if (!fs.existsSync(skillsDir)) { console.log(`  ✗ Directory not found: ${skillsDir}\n`); process.exit(1); }

  const skills = scanLocalSkills(skillsDir);
  console.log(`  Found: ${skills.length} skill(s)\n`);

  if (skills.length === 0) { console.log("  Nothing to import.\n"); process.exit(0); }

  skills.forEach(s => {
    const kb = Math.round(s.content.length / 1024);
    const f = s.files.length > 0 ? `, ${s.files.length} files` : "";
    console.log(`  • ${s.slug} (${kb}KB${f})`);
  });

  console.log("\n  Uploading...");
  const res = await api("/api/cli/import", token, url, {
    method: "POST",
    body: JSON.stringify({ skills }),
  });
  const result = await res.json();
  if (!res.ok) { console.log(`  ✗ ${result.error}\n`); process.exit(1); }

  console.log(`\n  ═══════════════════════════════════════`);
  console.log(`  ✓ Imported: ${result.imported}`);
  console.log(`  ⏭ Skipped:  ${result.skipped} (already exist)`);
  console.log(`  ═══════════════════════════════════════\n`);
}

async function cmdStatus(args) {
  const token = args.token || getToken();
  const url = args.url || getUrl();

  if (!token) { console.log("\n  ✗ Not logged in. Run: npx praxl login\n"); process.exit(1); }

  const data = await verifyToken(token, url);
  if (!data) { console.log("  ✗ Invalid token.\n"); process.exit(1); }

  const res = await api("/api/cli/sync", token, url);
  const result = await res.json();

  console.log(`\n  Praxl — ${data.user?.name || data.user?.email}`);
  console.log(`  ${result.skills.length} skills\n`);

  for (const s of result.skills) {
    const kb = Math.round(s.content.length / 1024);
    const active = s.isActive ? "✓" : "✗";
    console.log(`  ${active} ${s.slug.padEnd(30)} v${String(s.currentVersion).padEnd(5)} ${kb}KB`);
  }
  console.log();
}

// ─── Parse args & dispatch ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token" && argv[i+1]) { args.token = argv[++i]; }
    else if (a === "--url" && argv[i+1]) { args.url = argv[++i]; }
    else if (a === "--path" && argv[i+1]) { args.path = argv[++i]; }
    else if (a === "--platforms" && argv[i+1]) { args.platforms = argv[++i]; }
    else if (a === "--interval" && argv[i+1]) { args.interval = argv[++i]; }
    else if (a === "--watch") { args.watch = true; }
    else if (a === "--daemon") { args.daemon = true; }
    else if (!a.startsWith("-")) { positional.push(a); }
  }
  args._cmd = positional[0] || "sync";
  return args;
}

function showHelp() {
  console.log(`
  Praxl CLI v${VERSION} — Sync AI skills to your local tools

  COMMANDS
    praxl login               Save your auth token
    praxl sync                Download all skills to local folders
    praxl sync --watch        Watch mode (poll every 30s)
    praxl sync --daemon       Background daemon
    praxl import              Import local skills to Praxl cloud
    praxl status              Show your skills

  OPTIONS
    --token TOKEN             Auth token (or run 'praxl login' first)
    --url URL                 Praxl instance (default: ${DEFAULT_URL})
    --platforms a,b           Target platforms (default: claude-code)
                              Options: claude-code, cursor, codex, copilot,
                              windsurf, opencode, gemini-cli
    --path DIR                Skills directory for import (default: ~/.claude/skills)
    --interval SEC            Poll interval for watch/daemon (default: 30)

  EXAMPLES
    npx praxl login --token YOUR_TOKEN
    npx praxl sync --platforms claude-code,cursor
    npx praxl sync --watch --interval 15
    npx praxl import --path ~/.cursor/skills

  Get your token at: ${DEFAULT_URL}/settings
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args._cmd === "help" || args._cmd === "--help" || args._cmd === "-h") {
  showHelp();
} else if (args._cmd === "login") {
  cmdLogin(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "sync") {
  cmdSync(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "import") {
  cmdImport(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "status") {
  cmdStatus(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "version" || args._cmd === "--version" || args._cmd === "-v") {
  console.log(`praxl v${VERSION}`);
} else {
  // Default: sync
  cmdSync(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
}
