/// <reference types="vite/client" />

// Build-time published dataset, supplied by `vite-plugin-snapshot` from the
// backend's public R2 snapshot. Inlined into the bundle at build time; empty in
// dev and when no snapshot URL is configured.
declare module "virtual:tcab-snapshot" {
  import type { RunRecord } from "@test-cabinet/run-record";
  import type { TestCaseSummary } from "./data/testCases";

  /** Published run records, newest first (verbatim snapshot blobs). */
  export const runs: RunRecord[];
  /** Reconstructed `writeup.md` framing per run id (rating frontmatter + body). */
  export const writeups: Record<string, string>;
  /** Published test-case catalog metadata. */
  export const testCases: TestCaseSummary[];
}
