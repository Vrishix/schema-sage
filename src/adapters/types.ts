import type { DatabaseModel } from "../model/types.js";
import type { ScannedFile } from "../scanner/scan.js";

export interface DatabaseAdapter {
  name: string;
  detect(files: ScannedFile[]): boolean;
  /** Must not execute project code or open a database connection. */
  extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel>;
  supportedFeatures: string[];
}
