#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { exec } from "child_process";

const VERSION = "2.1.1";
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

// ─── Open browser ──────────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
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

// ─── Scan command (zero signup, local only) ────────────────────────────────

const SCAN_PATHS = {
  "claude-code": [
    path.join(HOME, ".claude", "skills"),
    path.join(HOME, ".claude", "commands"),
  ],
  "cursor": [
    path.join(HOME, ".cursor", "skills"),
    path.join(HOME, ".cursor", "rules"),
  ],
  "codex": [
    path.join(HOME, ".agents", "skills"),
  ],
  "windsurf": [
    path.join(HOME, ".windsurf", "skills"),
    path.join(HOME, ".windsurf", "rules"),
  ],
  "opencode": [
    path.join(HOME, ".opencode", "skills"),
  ],
  "gemini-cli": [
    path.join(HOME, ".gemini", "skills"),
  ],
  "copilot": [
    path.join(HOME, ".github", "copilot-instructions"),
  ],
  "claude.ai": [
    path.join(HOME, ".claude", "skills"),
  ],
};

function scanAllPlatforms() {
  const results = []; // { platform, dir, slug, content, hash }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  for (const [platform, dirs] of Object.entries(SCAN_PATHS)) {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      let entries;
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const entry of entries) {
        const skillMd = path.join(dir, entry, "SKILL.md");
        const singleFile = path.join(dir, entry);
        let content = null;
        let slug = entry;

        if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
          content = fs.readFileSync(skillMd, "utf-8");
        } else if (entry.endsWith(".md") && fs.statSync(singleFile).isFile()) {
          content = fs.readFileSync(singleFile, "utf-8");
          slug = entry.replace(/\.md$/, "");
        }

        if (content) {
          results.push({ platform, dir, slug, content, hash: hash(content) });
        }
      }
    }
  }
  return results;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function cmdScan() {
  const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    white: "\x1b[97m",
  };

  console.log();

  // Map unique dirs to their platform labels (for display)
  const dirToPlatforms = new Map(); // resolved dir → [platform names]
  for (const [platform, dirs] of Object.entries(SCAN_PATHS)) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!dirToPlatforms.has(resolved)) dirToPlatforms.set(resolved, []);
      const list = dirToPlatforms.get(resolved);
      if (!list.includes(platform)) list.push(platform);
    }
  }

  // Scan each unique directory once
  // Track: dirKey → [{ slug, hash, content }]
  const scannedDirs = []; // { resolvedDir, platforms, skills: [{ slug, hash }] }

  for (const [resolvedDir, platforms] of dirToPlatforms) {
    if (!fs.existsSync(resolvedDir)) continue;
    let entries;
    try { entries = fs.readdirSync(resolvedDir); } catch { continue; }

    const skills = [];
    for (const entry of entries) {
      const skillMd = path.join(resolvedDir, entry, "SKILL.md");
      const singleFile = path.join(resolvedDir, entry);
      let content = null;
      let slug = entry;

      try {
        if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
          content = fs.readFileSync(skillMd, "utf-8");
        } else if (entry.endsWith(".md") && fs.statSync(singleFile).isFile()) {
          content = fs.readFileSync(singleFile, "utf-8");
          slug = entry.replace(/\.md$/, "");
        }
      } catch { continue; }

      if (content) {
        let h = 0;
        for (let i = 0; i < content.length; i++) h = ((h << 5) - h + content.charCodeAt(i)) | 0;
        skills.push({ slug, hash: h });
      }
    }

    if (skills.length > 0) {
      scannedDirs.push({ resolvedDir, platforms, skills });
      const displayDir = resolvedDir.replace(HOME, "~");
      process.stdout.write(`  Scanning ${c.dim}${displayDir.padEnd(30)}${c.reset} found ${c.bold}${skills.length} skills${c.reset}\n`);
      await sleep(150);
    }
  }

  // Count unique skills across all scanned dirs
  // A slug in dir A and dir B = duplicate (exists in 2 locations)
  const slugLocations = new Map(); // slug → [{ dir, platforms, hash }]
  for (const { resolvedDir, platforms, skills } of scannedDirs) {
    for (const s of skills) {
      if (!slugLocations.has(s.slug)) slugLocations.set(s.slug, []);
      slugLocations.get(s.slug).push({ dir: resolvedDir, platforms, hash: s.hash });
    }
  }

  const uniqueSlugs = slugLocations.size;
  const totalLocations = [...slugLocations.values()].reduce((sum, locs) => sum + locs.length, 0);
  const totalTools = scannedDirs.length;

  if (uniqueSlugs === 0) {
    console.log(`\n  ${c.dim}No skills found on this machine.${c.reset}`);
    console.log(`\n  Create your first skill:`);
    console.log(`  ${c.cyan}mkdir -p ~/.claude/skills/my-skill${c.reset}`);
    console.log(`  Then create a SKILL.md inside it.`);
    console.log(`\n  Learn more: ${c.cyan}https://praxl.app${c.reset}\n`);
    return;
  }

  // Analyze duplicates & outdated
  const duplicateSlugs = []; // slugs that exist in 2+ directories
  const outdatedSlugs = []; // duplicates with different content
  let notSyncedCount = 0; // slugs only in 1 directory

  for (const [slug, locs] of slugLocations) {
    if (locs.length > 1) {
      duplicateSlugs.push(slug);
      const hashes = new Set(locs.map(l => l.hash));
      if (hashes.size > 1) outdatedSlugs.push(slug);
    } else {
      notSyncedCount++;
    }
  }

  // Estimate: ~2 min per skill per extra location, ~1.5 updates/week
  const weeklyMinutes = totalTools > 1 ? Math.round(uniqueSlugs * (totalTools - 1) * 2 * 1.5 / totalTools) : 0;

  // ── Summary box ──
  // Use a simple function to pad lines inside the box
  const BOX_W = 45;
  const boxLine = (text, rawLen) => {
    const pad = Math.max(1, BOX_W - rawLen - 2);
    return `  ${c.dim}|${c.reset}  ${text}${" ".repeat(pad)}${c.dim}|${c.reset}`;
  };

  console.log();
  console.log(`  ${c.dim}┌${"─".repeat(BOX_W)}┐${c.reset}`);

  const mainLine = `${uniqueSlugs} skills across ${totalTools} location${totalTools !== 1 ? "s" : ""}`;
  console.log(boxLine(`${c.bold}${c.white}${uniqueSlugs} skills${c.reset} across ${c.bold}${totalTools} location${totalTools !== 1 ? "s" : ""}${c.reset}`, mainLine.length));

  if (duplicateSlugs.length > 0) {
    const t = `${duplicateSlugs.length} duplicates detected`;
    console.log(boxLine(`${c.yellow}${t}${c.reset}`, t.length));
  }

  if (outdatedSlugs.length > 0) {
    const t = `${outdatedSlugs.length} outdated versions`;
    console.log(boxLine(`${c.red}${t}${c.reset}`, t.length));
  }

  if (notSyncedCount > 0 && totalTools > 1) {
    const t = `${notSyncedCount} skills only in 1 location`;
    console.log(boxLine(`${t}`, t.length));
  }

  if (weeklyMinutes > 0) {
    const t = `~${weeklyMinutes} min/week spent on manual sync`;
    console.log(boxLine(`${c.dim}${t}${c.reset}`, t.length));
  }

  console.log(`  ${c.dim}└${"─".repeat(BOX_W)}┘${c.reset}`);

  // ── Detail breakdown ──
  if (duplicateSlugs.length > 0) {
    console.log(`\n  ${c.yellow}Duplicates:${c.reset}`);
    for (const slug of duplicateSlugs.slice(0, 8)) {
      const locs = slugLocations.get(slug);
      const dirs = locs.map(l => l.dir.replace(HOME, "~").replace(/.*\/\./, "~/.")).join(", ");
      const hashes = new Set(locs.map(l => l.hash));
      const marker = hashes.size > 1 ? `${c.red}different versions${c.reset}` : `${c.dim}identical${c.reset}`;
      console.log(`    ${slug} ${c.dim}→${c.reset} ${dirs} ${c.dim}(${c.reset}${marker}${c.dim})${c.reset}`);
    }
    if (duplicateSlugs.length > 8) {
      console.log(`    ${c.dim}...and ${duplicateSlugs.length - 8} more${c.reset}`);
    }
  }

  // ── Recommendation ──
  console.log();
  if (duplicateSlugs.length > 0 || totalTools > 1) {
    console.log(`  ${c.green}Fix this?${c.reset} Run: ${c.cyan}npx praxl-cli@latest connect${c.reset}`);
    console.log(`  ${c.dim}Auto-imports, deduplicates, and keeps everything in sync.${c.reset}`);
  } else {
    console.log(`  ${c.green}Manage your skills in the cloud:${c.reset} ${c.cyan}npx praxl-cli@latest connect${c.reset}`);
    console.log(`  ${c.dim}Version control, AI review, deploy to more tools.${c.reset}`);
  }
  console.log(`  ${c.dim}Learn more: https://praxl.app${c.reset}`);
  console.log();
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

// ─── Connect: one command for everything ────────────────────────────────────

async function cmdConnect(args) {
  let token = args.token || getToken();
  const url = args.url || getUrl();
  const interval = parseInt(args.interval) || 15;

  console.log(`\n  ╔═══════════════════════════════════════╗`);
  console.log(`  ║  Praxl Connect                         ║`);
  console.log(`  ╚═══════════════════════════════════════╝\n`);

  // Auto-login if no token
  if (!token) {
    const signupUrl = `${url}/sign-up`;
    console.log(`  No account yet? Opening browser to sign up...\n`);
    openBrowser(signupUrl);
    console.log(`  ${signupUrl}`);
    console.log(`\n  After signing up, go to Settings to copy your CLI token.`);
    console.log(`  (${url}/settings)\n`);
    token = await prompt("  Paste your token: ");
    if (!token) { console.log("  ✗ Token required.\n"); process.exit(1); }
  }

  // Verify
  const data = await verifyToken(token, url);
  if (!data) { console.log("  ✗ Invalid token.\n"); process.exit(1); }

  saveToken(token);
  saveConfig({ ...loadConfig(), url });

  const userName = data.user?.name || data.user?.email || "unknown";
  console.log(`  ✓ Connected as ${userName}\n`);

  // Fetch platform config
  let syncPlatforms = ["claude-code"];
  let platformPaths = { ...PLATFORM_PATHS };
  try {
    const configRes = await api("/api/cli/config", token, url);
    if (configRes.ok) {
      const config = await configRes.json();
      const active = config.targets?.filter(t => t.isActive) || [];
      if (active.length > 0) {
        syncPlatforms = active.map(t => t.platform);
        for (const t of active) {
          if (t.basePath) platformPaths[t.platform] = t.basePath.replace(/^~/, HOME);
        }
      }
    }
  } catch {}

  const watchDirs = syncPlatforms.map(p => platformPaths[p] || path.join(HOME, `.${p}/skills`));
  console.log(`  Platforms: ${syncPlatforms.join(", ")}`);
  watchDirs.forEach(d => console.log(`  📁 ${d}`));
  console.log(`  Polling: every ${interval}s (bidirectional)`);
  console.log(`  Press Ctrl+C to disconnect\n`);

  const log = (msg) => {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`  [${ts}] ${msg}`);
  };

  // ── Fetch assignments (which skills → which platforms) ──
  let skillAssignments = {}; // platform → [slugs]
  let hasAssignments = false;

  async function fetchAssignments() {
    try {
      const res = await api("/api/cli/assignments", token, url);
      if (res.ok) {
        const data = await res.json();
        skillAssignments = data.assignments || {};
        hasAssignments = data.hasAssignments || false;
      }
    } catch {}
  }

  function isSkillAssignedToPlatform(slug, platform) {
    // Only sync skills that are explicitly assigned to this platform
    return skillAssignments[platform]?.includes(slug) || false;
  }

  // ── Cloud → Local sync ──
  async function pullFromCloud(incremental = false) {
    const since = incremental ? (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")).lastSync; } catch { return null; } })() : null;
    const endpoint = `/api/cli/sync${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const res = await api(endpoint, token, url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    let synced = 0;
    for (const skill of result.skills) {
      if (!skill.isActive) continue;
      for (const platform of syncPlatforms) {
        if (!isSkillAssignedToPlatform(skill.slug, platform)) continue;
        const base = platformPaths[platform] || path.join(HOME, `.${platform}/skills`);
        if (writeSkill(base, skill.slug, skill.content, skill.files)) {
          synced++;
          // Remember what we wrote so we don't create change request for our own writes
          deployedHashes.set(skill.slug, hashContent(skill.content));
          localHashes.set(skill.slug, hashContent(skill.content));
        }
      }
    }
    ensureConfigDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: result.syncedAt }));
    return { synced, total: result.skills.length };
  }

  // ── Local → Cloud sync ──
  const localHashes = new Map(); // slug → content hash

  function hashContent(content) {
    let h = 0;
    for (let i = 0; i < content.length; i++) { h = ((h << 5) - h + content.charCodeAt(i)) | 0; }
    return h;
  }

  // Known cloud slugs (populated after initial pull)
  const cloudSlugs = new Set();

  function scanLocalChanges() {
    const changes = [];
    const newSkills = [];
    for (const dir of watchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const slug of fs.readdirSync(dir)) {
        const skillMd = path.join(dir, slug, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        const content = fs.readFileSync(skillMd, "utf-8");
        const hash = hashContent(content);
        const prev = localHashes.get(slug);

        if (prev === undefined) {
          // First scan OR new local skill
          if (localHashes.size > 0 && !cloudSlugs.has(slug)) {
            // localHashes populated = not initial scan, and not in cloud = new local skill
            newSkills.push({ slug, content, dir, type: "new" });
          }
        } else if (prev !== hash) {
          changes.push({ slug, content, dir, type: "changed" });
        }
        localHashes.set(slug, hash);
      }
    }
    return [...changes, ...newSkills];
  }

  // Store deployed content hashes to detect real changes vs our own writes
  const deployedHashes = new Map();

  async function submitChangeRequests(changes) {
    const changeRequests = changes.map(c => {
      // Find what the deployed content was (to include as oldContent)
      const deployedHash = deployedHashes.get(c.slug);
      return {
        slug: c.slug,
        platform: syncPlatforms[0] || "unknown",
        oldContent: null, // server will compare
        newContent: c.content,
      };
    });

    if (changeRequests.length === 0) return;

    try {
      const res = await api("/api/cli/change-request", token, url, {
        method: "POST",
        body: JSON.stringify({ changes: changeRequests }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.created > 0) {
          log(`📋 ${result.created} change request(s) submitted — review in Praxl web app`);
        }
      }
    } catch (e) {
      log(`✗ Failed to submit changes: ${e.message}`);
    }
  }

  // ── Heartbeat ──
  // Report local file state to cloud
  async function reportLocalState() {
    const localSkills = [];
    for (const platform of syncPlatforms) {
      const dir = platformPaths[platform] || path.join(HOME, `.${platform}/skills`);
      if (!fs.existsSync(dir)) continue;
      for (const slug of fs.readdirSync(dir)) {
        const skillMd = path.join(dir, slug, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        const stat = fs.statSync(skillMd);
        localSkills.push({ platform, slug, localPath: path.join(dir, slug), sizeBytes: stat.size, lastModified: stat.mtime.toISOString() });
      }
    }
    try {
      await api("/api/cli/report-local", token, url, { method: "POST", body: JSON.stringify({ skills: localSkills }) });
    } catch {}
  }

  async function heartbeat(skillCount) {
    try {
      const res = await api("/api/cli/heartbeat", token, url, {
        method: "POST",
        body: JSON.stringify({ platforms: syncPlatforms, hostname: os.hostname(), mode: "connect", skillCount }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.command?.action === "sync") {
          log("⚡ Sync triggered from web app");
          const r = await pullFromCloud(false);
          log(`✓ Pulled ${r.synced} files (${r.total} skills)`);
        }
        if (data.command?.action === "disconnect") {
          log("🔌 Disconnect signal received from web app");
          log("Goodbye!\n");
          process.exit(0);
        }
      }
      // Also report local state periodically
      await reportLocalState();
    } catch {}
  }

  // ── Initial sync ──
  log("Fetching assignments & skills...");
  try {
    await fetchAssignments();
    if (hasAssignments) {
      const assigned = Object.values(skillAssignments).flat();
      log(`Assignments: ${[...new Set(assigned)].length} skills mapped to platforms`);
    } else {
      log("No assignments configured — syncing all skills to all platforms");
    }
    // Get cloud skill list
    const listRes = await api("/api/cli/sync", token, url);
    if (listRes.ok) {
      const listData = await listRes.json();
      listData.skills.forEach(s => cloudSlugs.add(s.slug));
    }
    const r = await pullFromCloud(false);
    log(`✓ ${r.synced} files synced (${r.total} skills total)`);
    await heartbeat(r.total);
  } catch (e) { log(`✗ ${e.message}`); }

  // Initialize local hashes (for change detection — won't trigger push on first scan)
  scanLocalChanges();
  log("Watching for changes (bidirectional)...\n");

  // ── Poll loop ──
  let lastSkillCount = 0;
  setInterval(async () => {
    try {
      // 0. Refresh assignments (user may change in web app)
      await fetchAssignments();

      // 1. Check for local changes → submit as change requests
      const localChanges = scanLocalChanges();
      if (localChanges.length > 0) {
        await submitChangeRequests(localChanges);
      }

      // 2. Check for cloud changes → pull to local
      const r = await pullFromCloud(true);
      if (r.total > 0) {
        log(`↓ Pulled ${r.synced} updated files`);
        lastSkillCount = r.total;
        scanLocalChanges();
      }

      // 3. Heartbeat + report local state
      await heartbeat(lastSkillCount);
    } catch (e) { /* silent */ }
  }, interval * 1000);
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
    praxl-cli scan               Scan local skills (no signup needed)
    praxl-cli connect            Connect & sync (recommended)
    praxl-cli login              Save your auth token
    praxl-cli sync               One-time download
    praxl-cli sync --watch       Watch mode (poll every 30s)
    praxl-cli import             Import local skills to Praxl cloud
    praxl-cli status             Show your skills

  OPTIONS
    --token TOKEN             Auth token (auto-prompt if missing)
    --url URL                 Praxl instance (default: ${DEFAULT_URL})
    --interval SEC            Sync interval in seconds (default: 15)

  EXAMPLES
    npx praxl-cli@latest scan
    npx praxl-cli@latest connect
    npx praxl-cli@latest import --path ~/.cursor/skills

  Get your token at: ${DEFAULT_URL}/settings
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args._cmd === "help" || args._cmd === "--help" || args._cmd === "-h") {
  showHelp();
} else if (args._cmd === "scan") {
  cmdScan().catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "connect") {
  cmdConnect(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
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
  // Default: connect (the main command)
  cmdConnect(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
}
