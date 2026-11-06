/**
 * Finds line numbers for models and fields so every fact can link to its source.
 * Reads text only. Prisma's own reader does not expose positions.
 */
export interface ModelLocation {
  name: string;
  startLine: number;
  endLine: number;
  fieldLines: Map<string, number>;
}

export function locateModels(text: string): ModelLocation[] {
  const lines = text.split(/\r?\n/);
  const out: ModelLocation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*model\s+(\w+)\s*\{/.exec(lines[i]);
    if (!m) continue;
    const fieldLines = new Map<string, number>();
    let j = i + 1;
    while (j < lines.length && !/^\s*\}/.test(lines[j])) {
      const f = /^\s*(\w+)\s+[\w\[\]?]+/.exec(lines[j]);
      if (f && !lines[j].trim().startsWith("@@") && !lines[j].trim().startsWith("//")) fieldLines.set(f[1], j + 1);
      j++;
    }
    out.push({ name: m[1], startLine: i + 1, endLine: j + 1, fieldLines });
    i = j;
  }
  return out;
}
