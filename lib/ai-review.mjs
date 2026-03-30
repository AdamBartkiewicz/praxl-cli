// AI-powered skill review via public API
// Requires network access, rate limited, graceful fallback

const DEFAULT_API_URL = "https://go.praxl.app";
const TIMEOUT_MS = 30000;

/**
 * Review skills using the public batch API
 * @param {Array<{name: string, content: string}>} skills
 * @param {string} apiUrl
 * @returns {Promise<Array<{name: string, score: number, issues: string[]}> | null>}
 */
export async function reviewSkillsWithAI(skills, apiUrl = DEFAULT_API_URL) {
  const results = [];
  const chunkSize = 5;

  // Process in chunks, max 3 concurrent
  for (let i = 0; i < skills.length; i += chunkSize) {
    const chunk = skills.slice(i, i + chunkSize);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(`${apiUrl}/api/public/batch-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: chunk }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        return { error: "rate_limit", message: "AI review rate limit exceeded. Try again tomorrow." };
      }

      if (!res.ok) {
        // Fallback: return null so caller uses offline scoring
        return null;
      }

      const data = await res.json();
      if (data.reviews) {
        results.push(...data.reviews);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        return { error: "timeout", message: "AI review timed out. Using offline scoring." };
      }
      // Network error
      return null;
    }
  }

  return results;
}

/**
 * Review a single skill via public API
 * @param {string} content
 * @param {string} apiUrl
 * @returns {Promise<object | null>}
 */
export async function reviewSingleSkill(content, apiUrl = DEFAULT_API_URL) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${apiUrl}/api/public/review-skill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
