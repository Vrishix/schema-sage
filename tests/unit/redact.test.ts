import { describe, it, expect } from "vitest";
import { redactPatterns } from "../../src/redaction/patterns.js";

describe("pattern redaction", () => {
  it("redacts passwords in connection strings and keeps host", () => {
    const { text } = redactPatterns("url = postgresql://app:Sup3rSecret@db.internal:5432/app");
    expect(text).toBe("url = postgresql://app:[REDACTED]@db.internal:5432/app");
  });

  it("redacts NAME_SECRET style assignments", () => {
    const { text } = redactPatterns('JWT_SECRET="abc123xyz789"');
    expect(text).toBe('JWT_SECRET="[REDACTED]"');
  });

  it("redacts common key shapes", () => {
    const { text } = redactPatterns("k sk_test_0123456789abcdef and AKIA0123456789ABCDEF and ghp_abcdefghijklmnopqrstuvwx");
    expect(text).not.toMatch(/sk_test_0123|AKIA0123|ghp_abcdef/);
    expect(text.match(/\[REDACTED\]/g)?.length).toBe(3);
  });

  it("leaves ordinary text alone", () => {
    const input = "model User { id Int @id }";
    expect(redactPatterns(input)).toEqual({ text: input, hits: [] });
  });
});
