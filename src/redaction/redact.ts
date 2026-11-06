/**
 * Secret redaction for all generated output.
 * Values come from .env-style files, which are parsed for values only and
 * never copied into the model. Any occurrence of a known value in output text
 * is replaced with a placeholder.
 */
const MIN_SECRET_LENGTH = 6;

export function parseEnvValues(envText: string): string[] {
  const values: string[] = [];
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (value.length >= MIN_SECRET_LENGTH) values.push(value);
  }
  // Longest first, so a secret containing another is replaced whole.
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}
