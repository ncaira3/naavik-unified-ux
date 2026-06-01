/**
 * Guardrails Service — 4 safety checks for the chat agent.
 *
 * Guard 1 — Bulk dump block
 *   Prevents queries estimated to return > 5,000 rows. Reuse estimateQueryCost.
 *   Called inside individual tool execute() functions.
 *
 * Guard 2 — Destructive SQL block
 *   Rejects any SQL containing DDL/DML keywords (DROP, DELETE, UPDATE, etc.).
 *   Called inside the run_sql_query / query_data tool execute().
 *
 * Guard 3 — Scope enforcement
 *   Rejects clearly off-topic messages before the orchestrator runs.
 *   Called in the SSE route + agentV3Chat() entry point.
 *
 * Guard 4 — Site ID validation gate
 *   Validates USID format (4–6 digit numeric string).
 *   Called inside any tool that accepts a `usid` parameter.
 */

// ─── Guard 2: Destructive SQL ────────────────────────────────────────────────

const DESTRUCTIVE_PATTERN =
  /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|EXEC|EXECUTE|MERGE|REPLACE|RENAME|GRANT|REVOKE|COMMIT|ROLLBACK)\b/i;

/**
 * Returns an error message if the SQL contains destructive keywords, or null
 * if the query is safe to run.
 */
export function checkDestructiveSql(sql: string): string | null {
  if (DESTRUCTIVE_PATTERN.test(sql)) {
    const match = sql.match(DESTRUCTIVE_PATTERN);
    return (
      `GUARDRAIL: Destructive SQL keyword "${match?.[0] ?? 'unknown'}" is not permitted. ` +
      `Only SELECT queries are allowed on this system.`
    );
  }
  return null;
}

// ─── Guard 3: Scope enforcement ─────────────────────────────────────────────

const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\b(tell me a joke|write me a (poem|song|story|essay)|draw|paint)\b/i,
  /\b(stock (price|market)|cryptocurrency|bitcoin|forex)\b/i,
  /\b(sports score|who (won|lost) (the )?(game|match|championship))\b/i,
  /\b(recipe|how to cook|ingredients for)\b/i,
  /\b(movie|tv show|netflix|series|episode) (review|recommendation|rating)\b/i,
  /\b(weather forecast for|what\'s the weather in)\b/i,
  /\b(translate (this |that )?(text|sentence|word|phrase) (to|into|from))\b/i,
  /\b(write (me )?(some )?(code|a script|a program|an app) (in|using|with) (python|java|javascript|rust|go|ruby))\b/i,
  /\b(help me (with )?(my )?(homework|essay|assignment|thesis|dissertation))\b/i,
];

const TELECOM_HINTS: RegExp[] = [
  /\b(site|usid|cell|sector|kpi|rca|network|outage|tilt|ret|handover|throughput|lte|5g|4g|carrier|band|neighbor|cluster|ticket|anomaly|alarm)\b/i,
];

/**
 * Guard 3: Check if the message is clearly off-topic for a telecom analysis agent.
 * Returns a polite refusal message, or null if the message should proceed.
 *
 * Strategy: only block if there's a clear off-topic match AND no telecom keywords.
 * This avoids false positives (e.g. "what's the weather-related impact on site X").
 */
export function checkScope(message: string): string | null {
  const hasTelecomHint = TELECOM_HINTS.some((p) => p.test(message));
  if (hasTelecomHint) return null; // telecom context present — let it through

  const isOffTopic = OFF_TOPIC_PATTERNS.some((p) => p.test(message));
  if (isOffTopic) {
    return (
      `I'm Naavik — your telecom network analysis co-pilot. I'm focused on ` +
      `site performance, KPIs, outages, config changes, and RCA. ` +
      `What network question can I help with?`
    );
  }
  return null;
}

// ─── Guard 4: Site ID validation ─────────────────────────────────────────────

/**
 * Returns true if `usid` looks like a valid AT&T/telecom site USID
 * (4–8 alphanumeric characters, typically 4–6 digits).
 */
export function isValidUsid(usid: string): boolean {
  // Must be 4–8 characters of digits only (AT&T USIDs are numeric, 4–6 digits)
  return /^\d{4,8}$/.test(usid.trim());
}

/**
 * Returns an error result if the USID is invalid, or null if it's valid.
 * Pass the `usid` arg from the tool parameter.
 */
export function checkUsid(usid: unknown): string | null {
  if (!usid || typeof usid !== 'string') {
    return `GUARDRAIL: A site ID (USID) is required for this tool. Please provide a valid USID (4–6 digit number).`;
  }
  const trimmed = usid.trim();
  if (!isValidUsid(trimmed)) {
    return (
      `GUARDRAIL: "${trimmed}" does not look like a valid site ID. ` +
      `USIDs are typically 4–6 digit numbers (e.g. 9787, 13081). Please confirm the site ID.`
    );
  }
  return null;
}
