#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { exec } from "child_process";

const VERSION = "1.0.1";
const PKG_NAME = "praxl-app";
const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".praxl");
const TOKEN_FILE = path.join(CONFIG_DIR, "token");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const STATE_FILE = path.join(CONFIG_DIR, "sync-state.json");
const LOG_FILE = path.join(CONFIG_DIR, "sync.log");
const PID_FILE = path.join(CONFIG_DIR, "sync.pid");

const DEFAULT_URL = "https://go.praxl.app";

// ─── Auto-update check (non-blocking) ──────────────────────────────────────

async function checkForUpdate() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = await res.json();
    const latest = data.version;
    if (latest && latest !== VERSION) {
      const c = { yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };
      console.log(`\n  ${c.yellow}Update available: ${VERSION} → ${latest}${c.reset}`);
      console.log(`  Run: ${c.cyan}npm install -g ${PKG_NAME}${c.reset}\n`);
    }
  } catch {
    // Silent - don't block CLI usage
  }
}

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
  // Ignore localhost URLs from old dev configs
  if (config.url && !config.url.includes("localhost") && !config.url.includes("127.0.0.1")) {
    return config.url;
  }
  return DEFAULT_URL;
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

async function cmdScan(args) {
  const useAi = args.ai || false;
  const jsonOutput = args.json || false;
  const c = jsonOutput ? { reset:"",dim:"",bold:"",green:"",yellow:"",red:"",cyan:"",white:"" } : {
    reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
    green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
    cyan: "\x1b[36m", white: "\x1b[97m",
  };

  const { scoreSkillOffline, securityScan } = await import("../lib/quality.mjs");

  if (!jsonOutput) console.log();

  // Map dirs to platforms
  const dirToPlatforms = new Map();
  for (const [platform, dirs] of Object.entries(SCAN_PATHS)) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!dirToPlatforms.has(resolved)) dirToPlatforms.set(resolved, []);
      const list = dirToPlatforms.get(resolved);
      if (!list.includes(platform)) list.push(platform);
    }
  }

  // Scan directories, collect full content for scoring
  const allSkills = []; // { slug, content, hash, platforms, dir }
  const scannedDirs = [];

  for (const [resolvedDir, platforms] of dirToPlatforms) {
    if (!fs.existsSync(resolvedDir)) continue;
    let entries;
    try { entries = fs.readdirSync(resolvedDir); } catch { continue; }

    const dirSkills = [];
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
        dirSkills.push({ slug, content, hash: h });
      }
    }

    if (dirSkills.length > 0) {
      scannedDirs.push({ resolvedDir, platforms, skills: dirSkills });
      if (!jsonOutput) {
        const displayDir = resolvedDir.replace(HOME, "~");
        process.stdout.write(`  Scanning ${c.dim}${displayDir.padEnd(30)}${c.reset} found ${c.bold}${dirSkills.length} skills${c.reset}\n`);
      }
    }
  }

  // Deduplicate by slug (keep first occurrence, track all platforms)
  const slugMap = new Map(); // slug → { content, hash, platforms: Set, dirs: [] }
  for (const { resolvedDir, platforms, skills } of scannedDirs) {
    for (const s of skills) {
      if (!slugMap.has(s.slug)) {
        slugMap.set(s.slug, { content: s.content, hash: s.hash, platforms: new Set(), dirs: [], hashes: new Set() });
      }
      const entry = slugMap.get(s.slug);
      platforms.forEach(p => entry.platforms.add(p));
      entry.dirs.push(resolvedDir);
      entry.hashes.add(s.hash);
    }
  }

  if (slugMap.size === 0) {
    if (jsonOutput) { console.log(JSON.stringify({ skills: [], summary: {} })); return; }
    console.log(`\n  ${c.dim}No skills found.${c.reset}\n`);
    return;
  }

  // Score and scan each unique skill
  const results = [];
  for (const [slug, data] of slugMap) {
    const quality = scoreSkillOffline(data.content);
    const security = securityScan(data.content);
    results.push({
      slug,
      score: quality.score,
      breakdown: quality.breakdown,
      security,
      platforms: [...data.platforms],
      dirs: data.dirs,
      isDuplicate: data.dirs.length > 1,
      hasVersionConflict: data.hashes.size > 1,
    });
  }

  // AI review (optional)
  let aiResults = null;
  if (useAi && !jsonOutput) {
    try {
      const { reviewSkillsWithAI } = await import("../lib/ai-review.mjs");
      console.log(`\n  ${c.cyan}Running AI review...${c.reset}`);

      const skillsForAi = results.map(r => ({ name: r.slug, content: slugMap.get(r.slug).content }));
      const aiRes = await reviewSkillsWithAI(skillsForAi);

      if (aiRes && Array.isArray(aiRes)) {
        aiResults = new Map();
        for (const r of aiRes) aiResults.set(r.name, r);
        console.log(`  ${c.green}✓${c.reset} AI reviewed ${aiRes.length} skills\n`);
      } else if (aiRes?.error === "rate_limit") {
        console.log(`  ${c.yellow}⚠${c.reset} ${aiRes.message}\n`);
      } else {
        console.log(`  ${c.yellow}⚠${c.reset} AI unavailable, using offline scoring\n`);
      }
    } catch {
      console.log(`  ${c.yellow}⚠${c.reset} AI review failed, using offline scoring\n`);
    }
  }

  // ── JSON output ──
  if (jsonOutput) {
    const jsonData = {
      skills: results.map(r => ({
        slug: r.slug,
        score: aiResults?.get(r.slug)?.score ?? r.score,
        offlineScore: r.score,
        aiScore: aiResults?.get(r.slug)?.score ?? null,
        aiIssues: aiResults?.get(r.slug)?.issues ?? null,
        security: { safe: r.security.safe, criticalCount: r.security.criticalCount, warningCount: r.security.warningCount, flags: r.security.flags },
        platforms: r.platforms,
        isDuplicate: r.isDuplicate,
        hasVersionConflict: r.hasVersionConflict,
      })),
      summary: {
        total: results.length,
        averageScore: Math.round(results.reduce((s, r) => s + r.score, 0) / results.length * 10) / 10,
        safe: results.filter(r => r.security.safe).length,
        warnings: results.filter(r => r.security.warningCount > 0).length,
        critical: results.filter(r => r.security.criticalCount > 0).length,
        duplicates: results.filter(r => r.isDuplicate).length,
      },
    };
    console.log(JSON.stringify(jsonData, null, 2));
    return;
  }

  // ── Quality report ──
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length * 10) / 10;
  const safeCount = results.filter(r => r.security.safe).length;
  const warnCount = results.filter(r => r.security.warningCount > 0 && r.security.criticalCount === 0).length;
  const critCount = results.filter(r => r.security.criticalCount > 0).length;

  console.log(`\n  ${c.bold}Quality Report${c.reset}\n`);
  console.log(`  ${"Skill".padEnd(28)} ${"Score".padEnd(8)} ${"Security".padEnd(12)} Platforms`);
  console.log(`  ${c.dim}${"─".repeat(28)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(20)}${c.reset}`);

  for (const r of sorted) {
    const displayScore = aiResults?.get(r.slug)?.score ?? r.score;
    const scoreColor = displayScore >= 4 ? c.green : displayScore >= 2.5 ? c.yellow : c.red;
    const secLabel = r.security.criticalCount > 0
      ? `${c.red}✗ ${r.security.criticalCount} flag${r.security.criticalCount > 1 ? "s" : ""}${c.reset}`
      : r.security.warningCount > 0
      ? `${c.yellow}⚠ ${r.security.warningCount} warn${c.reset}`
      : `${c.green}✓ safe${c.reset}`;
    const platforms = r.platforms.slice(0, 3).join(", ") + (r.platforms.length > 3 ? "..." : "");

    console.log(`  ${r.slug.padEnd(28).slice(0, 28)} ${scoreColor}${String(displayScore).padEnd(4)}${c.reset}/5   ${secLabel.padEnd(22)} ${c.dim}${platforms}${c.reset}`);
  }

  console.log(`\n  Average: ${c.bold}${avgScore}/5${c.reset}  |  ${c.green}${safeCount} safe${c.reset}  ${warnCount > 0 ? `${c.yellow}${warnCount} warnings${c.reset}  ` : ""}${critCount > 0 ? `${c.red}${critCount} critical${c.reset}` : ""}`);

  // ── Security alerts ──
  const criticals = results.filter(r => r.security.criticalCount > 0);
  if (criticals.length > 0) {
    console.log(`\n  ${c.red}${c.bold}Security flags:${c.reset}`);
    for (const r of criticals) {
      for (const f of r.security.flags.filter(f => f.severity === "critical")) {
        console.log(`    ${c.red}✗${c.reset} ${r.slug}:${f.line} ${c.dim}${f.risk}${c.reset} ${c.dim}(${f.context})${c.reset}`);
      }
    }
  }

  // ── Duplicates ──
  const duplicates = results.filter(r => r.isDuplicate);
  if (duplicates.length > 0) {
    console.log(`\n  ${c.yellow}Duplicates:${c.reset} ${duplicates.length} skill${duplicates.length > 1 ? "s" : ""} in multiple locations`);
  }

  // ── Next steps ──
  console.log();
  if (!useAi) {
    console.log(`  ${c.cyan}npx praxl-cli@latest scan --ai${c.reset}    ${c.dim}AI-powered deep review${c.reset}`);
  }
  console.log(`  ${c.cyan}npx praxl-cli@latest connect${c.reset}       ${c.dim}Sync & manage in Praxl${c.reset}`);
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

  // ── Hashing ──
  function hashContent(content) {
    let h = 0;
    for (let i = 0; i < content.length; i++) { h = ((h << 5) - h + content.charCodeAt(i)) | 0; }
    return h;
  }

  // Key: "platform:slug" - tracks per-platform to handle same skill in multiple dirs
  const localHashes = new Map();    // "platform:slug" → hash
  const deployedHashes = new Map(); // "platform:slug" → hash (what cloud wrote)
  const cloudSlugs = new Set();
  let initialScanDone = false;

  // Map dir → platform name
  const dirToPlatform = new Map();
  for (const platform of syncPlatforms) {
    const dir = platformPaths[platform] || path.join(HOME, `.${platform}/skills`);
    dirToPlatform.set(dir, platform);
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
          const key = `${platform}:${skill.slug}`;
          // Mark as deployed so we don't create change request for our own writes
          const h = hashContent(skill.content);
          deployedHashes.set(key, h);
          localHashes.set(key, h);
        }
      }
    }
    ensureConfigDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSync: result.syncedAt }));
    return { synced, total: result.skills.length };
  }

  // ── Local → Cloud sync (per-platform change detection) ──
  function scanLocalChanges() {
    const changes = [];
    const newSkills = [];

    for (const [dir, platform] of dirToPlatform) {
      if (!fs.existsSync(dir)) continue;
      for (const slug of fs.readdirSync(dir)) {
        const skillMd = path.join(dir, slug, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        const content = fs.readFileSync(skillMd, "utf-8");
        const hash = hashContent(content);
        const key = `${platform}:${slug}`;
        const prev = localHashes.get(key);
        const deployedHash = deployedHashes.get(key);

        if (prev === undefined) {
          // First scan for this platform:slug
          if (initialScanDone && !cloudSlugs.has(slug)) {
            newSkills.push({ slug, content, dir, platform, type: "new" });
          }
        } else if (prev !== hash && hash !== deployedHash) {
          // Content changed AND differs from what cloud deployed
          // (skip if it matches deployed hash - that means cloud wrote it)
          changes.push({ slug, content, dir, platform, type: "changed" });
        }
        localHashes.set(key, hash);
      }
    }
    return [...changes, ...newSkills];
  }

  async function submitChangeRequests(changes) {
    // Each change has its own platform - submit separately per platform:slug
    const changeRequests = changes.map(c => ({
      slug: c.slug,
      platform: c.platform,
      oldContent: null,
      newContent: c.content,
    }));

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

  // Initialize local hashes (for change detection - won't trigger push on first scan)
  scanLocalChanges();
  initialScanDone = true;
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
    else if (a === "--ai") { args.ai = true; }
    else if (a === "--json") { args.json = true; }
    else if (!a.startsWith("-")) { positional.push(a); }
  }
  args._cmd = positional[0] || "sync";
  return args;
}

function showHelp() {
  console.log(`
  Praxl v${VERSION} — manage, sync, and deploy AI skills

  INSTALL
    npm install -g praxl-app

  COMMANDS
    praxl scan                  Scan + quality score + security check
    praxl scan --ai             Deep AI review (needs internet)
    praxl scan --json           Machine-readable JSON output
    praxl connect               Connect & sync (recommended)
    praxl login                 Save your auth token
    praxl sync                  One-time download
    praxl sync --watch          Watch mode (poll every 30s)
    praxl import                Import local skills to Praxl cloud
    praxl status                Show your skills

  OPTIONS
    --token TOKEN             Auth token (auto-prompt if missing)
    --url URL                 Praxl instance (default: ${DEFAULT_URL})
    --interval SEC            Sync interval in seconds (default: 15)

  EXAMPLES
    praxl scan
    praxl connect
    praxl import --path ~/.cursor/skills

  Get your token at: ${DEFAULT_URL}/settings
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args._cmd === "help" || args._cmd === "--help" || args._cmd === "-h") {
  showHelp();
} else if (args._cmd === "scan") {
  cmdScan(args).then(() => checkForUpdate()).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "connect") {
  cmdConnect(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "login") {
  cmdLogin(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "sync") {
  cmdSync(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "import") {
  cmdImport(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "status") {
  cmdStatus(args).then(() => checkForUpdate()).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
} else if (args._cmd === "version" || args._cmd === "--version" || args._cmd === "-v") {
  console.log(`praxl v${VERSION}`);
  checkForUpdate();
} else {
  // Default: connect (the main command)
  cmdConnect(args).catch(e => { console.error(`  ✗ ${e.message}\n`); process.exit(1); });
}
