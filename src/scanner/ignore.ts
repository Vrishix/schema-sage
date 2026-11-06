// Built-in ignores. A full .gitignore parser is planned for M5.
export const ALWAYS_IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "coverage", "artifacts", ".venv", "__pycache__",
]);

export const ALWAYS_IGNORED_FILES = /(^|\/)\.env(\..*)?$/;
