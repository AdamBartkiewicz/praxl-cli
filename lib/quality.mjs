// Offline quality scoring and security scanning for SKILL.md files
// No network, no auth, no dependencies - pure heuristic analysis

/**
 * Score a skill 0-5 based on structural heuristics
 * @param {string} content - raw SKILL.md content
 * @returns {{ score: number, breakdown: Record<string, number> }}
 */
export function scoreSkillOffline(content) {
  let score = 0;
  const breakdown = {};

  // +1.0: has YAML frontmatter
  const hasFrontmatter = /^---\n[\s\S]*?\n---/.test(content);
  breakdown.frontmatter = hasFrontmatter ? 1.0 : 0;
  score += breakdown.frontmatter;

  // +1.0: has description field > 50 chars
  const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const descLen = descMatch?.[1]?.length || 0;
  breakdown.description = descLen > 50 ? 1.0 : descLen > 20 ? 0.5 : 0;
  score += breakdown.description;

  // +1.0: has instruction section (H2)
  const hasInstructions = /^##\s+(instructions|how to use|usage|workflow|steps)/im.test(content);
  breakdown.instructions = hasInstructions ? 1.0 : 0;
  score += breakdown.instructions;

  // +1.0: has examples or code blocks
  const hasExamples = /^##\s+examples?/im.test(content) || (content.match(/```/g) || []).length >= 2;
  breakdown.examples = hasExamples ? 1.0 : 0;
  score += breakdown.examples;

  // +0.5: has error handling / troubleshooting section
  const hasErrorHandling = /^##\s+(error|troubleshoot|common (issues|problems|errors))/im.test(content);
  breakdown.errorHandling = hasErrorHandling ? 0.5 : 0;
  score += breakdown.errorHandling;

  // +0.5: description has trigger phrases (min 3)
  const desc = descMatch?.[1] || "";
  const triggerPhrases = ["use when", "trigger", "use this skill", "use this when", "invoke when", "activate when", "run when", "ask for", "request"];
  const triggerCount = triggerPhrases.filter(p => desc.toLowerCase().includes(p)).length;
  breakdown.triggers = triggerCount >= 3 ? 0.5 : triggerCount >= 1 ? 0.25 : 0;
  score += breakdown.triggers;

  // +0.5: has allowed-tools or compatibility in frontmatter
  const fmBlock = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
  const hasAdvancedFm = /^(allowed-tools|compatibility):/m.test(fmBlock);
  breakdown.advancedFrontmatter = hasAdvancedFm ? 0.5 : 0;
  score += breakdown.advancedFrontmatter;

  // +0.5: content length > 500
  breakdown.contentLength = content.length > 500 ? 0.5 : content.length > 200 ? 0.25 : 0;
  score += breakdown.contentLength;

  return { score: Math.round(Math.min(score, 5.0) * 10) / 10, breakdown };
}

/**
 * Security scan - regex-based pattern matching
 * @param {string} content - raw SKILL.md content
 * @returns {{ safe: boolean, flags: Array<{severity: string, pattern: string, line: number, context: string, risk: string}>, criticalCount: number, warningCount: number }}
 */
export function securityScan(content) {
  const criticalPatterns = [
    { re: /\b(exec|eval|system|spawn|popen|shell_exec)\s*\(/gi, risk: "Shell command execution" },
    { re: /\b(child_process|subprocess|os\.system)\b/gi, risk: "Process spawning" },
    { re: /\brm\s+-rf\s+[\/~]/g, risk: "Recursive file deletion" },
    { re: /\b(curl|wget|fetch)\s+https?:.*\|\s*(bash|sh|zsh)/gi, risk: "Remote code execution" },
    { re: /(API_KEY|SECRET_KEY|PRIVATE_KEY|PASSWORD)\s*[:=]\s*['"][^'"]{3,}['"]/gi, risk: "Hardcoded credentials" },
    { re: /base64[_-]?(decode|encode)\s*\(/gi, risk: "Content obfuscation" },
    { re: /\beval\s*\(\s*atob/gi, risk: "Obfuscated code execution" },
  ];

  const warningPatterns = [
    { re: /\bsudo\b/g, risk: "Elevated privileges" },
    { re: /\b(chmod|chown)\s+[0-7]{3,4}/g, risk: "Permission modification" },
    { re: /\b\.env\b/g, risk: "Environment file reference" },
    { re: /\bprivate[_-]?key\b/gi, risk: "Private key reference" },
    { re: /\bDROP\s+(TABLE|DATABASE)\b/gi, risk: "Database destruction" },
    { re: /\bnetcat\b|\bnc\s+-[le]/g, risk: "Network backdoor tool" },
    { re: /\breverse[_-]?shell\b/gi, risk: "Reverse shell reference" },
  ];

  const lines = content.split("\n");
  const flags = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const { re, risk } of criticalPatterns) {
      const regex = new RegExp(re.source, re.flags);
      const match = regex.exec(line);
      if (match) {
        const start = Math.max(0, match.index - 20);
        const end = Math.min(line.length, match.index + match[0].length + 20);
        flags.push({ severity: "critical", pattern: match[0], line: lineNum, context: line.slice(start, end).trim(), risk });
      }
    }

    for (const { re, risk } of warningPatterns) {
      const regex = new RegExp(re.source, re.flags);
      const match = regex.exec(line);
      if (match) {
        const start = Math.max(0, match.index - 20);
        const end = Math.min(line.length, match.index + match[0].length + 20);
        flags.push({ severity: "warning", pattern: match[0], line: lineNum, context: line.slice(start, end).trim(), risk });
      }
    }
  }

  const criticalCount = flags.filter(f => f.severity === "critical").length;
  const warningCount = flags.filter(f => f.severity === "warning").length;

  return { safe: criticalCount === 0, flags, criticalCount, warningCount };
}
