/**
 * Pattern-based secret redaction. Applied to every output file.
 * The tool does NOT read .env files, so it cannot know their values.
 * Instead it recognises common secret shapes wherever they appear in repository text.
 */
const RULES: { name: string; re: RegExp; replace: string | ((...m: string[]) => string) }[] = [
  // postgresql://user:password@host  ->  postgresql://user:[REDACTED]@host
  { name: "url-credentials", re: /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi, replace: "$1[REDACTED]$3" },
  // Stripe-style keys
  { name: "stripe-key", re: /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{8,}\b/g, replace: "[REDACTED]" },
  // AWS access key id
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[REDACTED]" },
  // GitHub tokens
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: "[REDACTED]" },
  // JSON Web Tokens
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: "[REDACTED]" },
  // NAME_SECRET=value style assignments
  {
    name: "secret-assignment",
    re: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)(\s*=\s*)(["']?)([^\s"'#]{6,})/g,
    replace: "$1$2$3[REDACTED]",
  },
];

export function redactPatterns(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args: unknown[]) => {
      hits.push(rule.name);
      const match = args[0] as string;
      if (typeof rule.replace === "string") {
        return match.replace(rule.re, rule.replace as string);
      }
      return rule.replace(...(args as string[]));
    });
  }
  return { text: out, hits };
}
