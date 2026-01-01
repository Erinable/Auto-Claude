/**
 * Output Parser Module
 * Handles parsing and pattern detection in terminal output
 */

import type { SubscriptionProvider } from './subscription-providers';

/**
 * Regex patterns to capture Claude session ID from output
 */
const CLAUDE_SESSION_PATTERNS = [
  /Session(?:\s+ID)?:\s*([a-zA-Z0-9_-]+)/i,
  /session[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i,
  /Resuming session:\s*([a-zA-Z0-9_-]+)/i,
  /conversation[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i,
];

/**
 * Regex pattern to detect Claude Code rate limit messages
 * Matches: "Limit reached · resets Dec 17 at 6am (Europe/Oslo)"
 */
const RATE_LIMIT_PATTERN = /Limit reached\s*[·•]\s*resets\s+(.+?)$/m;

/**
 * Regex pattern to capture OAuth token from `claude setup-token` output
 */
const OAUTH_TOKEN_PATTERN = /(sk-ant-oat01-[A-Za-z0-9_-]+)/;

/**
 * Token patterns for subscription providers
 */
const SUBSCRIPTION_TOKEN_PATTERNS: Record<SubscriptionProvider, RegExp[]> = {
  claude: [OAUTH_TOKEN_PATTERN],
  codex: [
    /(sk-codex-[A-Za-z0-9_-]+)/,
    /codex\s+token[:\s]+([A-Za-z0-9_-]{16,})/i,
  ],
  antigravity: [
    /(sk-antigravity-[A-Za-z0-9_-]+)/,
    /antigravity\s+token[:\s]+([A-Za-z0-9_-]{16,})/i,
  ]
};

/**
 * Pattern to detect email in Claude output
 */
const EMAIL_PATTERN = /(?:Authenticated as|Logged in as|email[:\s]+)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;

/**
 * Extract Claude session ID from output
 */
export function extractClaudeSessionId(data: string): string | null {
  for (const pattern of CLAUDE_SESSION_PATTERNS) {
    const match = data.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract rate limit reset time from output
 */
export function extractRateLimitReset(data: string): string | null {
  const match = data.match(RATE_LIMIT_PATTERN);
  return match ? match[1].trim() : null;
}

/**
 * Extract OAuth token from output
 */
export function extractOAuthToken(data: string): string | null {
  const match = data.match(OAUTH_TOKEN_PATTERN);
  return match ? match[1] : null;
}

/**
 * Extract a subscription token and provider from output
 */
export function extractSubscriptionToken(data: string): { provider: SubscriptionProvider; token: string } | null {
  for (const [provider, patterns] of Object.entries(SUBSCRIPTION_TOKEN_PATTERNS) as Array<[SubscriptionProvider, RegExp[]]>) {
    for (const pattern of patterns) {
      const match = data.match(pattern);
      if (match?.[1]) {
        return { provider, token: match[1] };
      }
    }
  }
  return null;
}

/**
 * Extract email from output
 */
export function extractEmail(data: string): string | null {
  const match = data.match(EMAIL_PATTERN);
  return match ? match[1] : null;
}

/**
 * Check if output contains a rate limit message
 */
export function hasRateLimitMessage(data: string): boolean {
  return RATE_LIMIT_PATTERN.test(data);
}

/**
 * Check if output contains an OAuth token
 */
export function hasOAuthToken(data: string): boolean {
  return OAUTH_TOKEN_PATTERN.test(data);
}

/**
 * Check if output contains any subscription token
 */
export function hasSubscriptionToken(data: string): boolean {
  return Object.values(SUBSCRIPTION_TOKEN_PATTERNS).some(patterns =>
    patterns.some(pattern => pattern.test(data))
  );
}
