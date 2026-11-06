import type { DatabaseModel } from "../model/types.js";

export interface ValidationIssue {
  rule: string;
  message: string;
}

/**
 * Structural checks on the normalized model. Returns an empty array when valid.
 * Rules come from the spec (v0.2 section 6).
 */
export function validateModel(model: DatabaseModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, number>();
  const add = (id: string) => ids.set(id, (ids.get(id) ?? 0) + 1);

  for (const t of model.tables) {
    add(t.id);
    if (t.evidence.length === 0) issues.push({ rule: "evidence", message: `${t.id} has no evidence` });
    for (const c of t.columns) {
      add(c.id);
      if (c.evidence.length === 0) issues.push({ rule: "evidence", message: `${c.id} has no evidence` });
    }
  }

  const columnIds = new Set(model.tables.flatMap((t) => t.columns.map((c) => c.id)));

  for (const r of model.relationships) {
    add(r.id);
    if (r.evidence.length === 0) issues.push({ rule: "evidence", message: `${r.id} has no evidence` });
    for (const ref of [r.from, r.to]) {
      if (!columnIds.has(ref)) issues.push({ rule: "dangling-reference", message: `${r.id} points to missing ${ref}` });
    }
    // A relationship may be "db-enforced" only when a migration file supports it.
    if (r.enforcement === "db-enforced" && !r.evidence.some((e) => e.file.endsWith(".sql"))) {
      issues.push({ rule: "enforcement", message: `${r.id} is db-enforced but has no migration evidence` });
    }
  }

  for (const f of model.findings) {
    add(f.id);
    if (f.evidence.length === 0) issues.push({ rule: "evidence", message: `${f.id} has no evidence` });
  }

  for (const [id, count] of ids) {
    if (count > 1) issues.push({ rule: "duplicate-id", message: `${id} appears ${count} times` });
  }

  return issues;
}
