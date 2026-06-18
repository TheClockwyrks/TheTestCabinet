// Curated implementation reviews. A review is a hand-written note shown on a
// run's page before its playable build is launched (see
// docs/site.md#implementation-writeups). It carries a quality rating and a
// Markdown body; neither is part of the run record. A review travels to the site
// as part of the backend's public R2 snapshot, alongside the run record (see
// design/v0.2.0-contracts.md §3); `vite-plugin-snapshot` reconstructs each as
// the `---\nrating: …\n---\n\n<body>` writeup framing, keyed by run id, and
// inlines it into the bundle at build time.
import { type ParsedWriteup, parseWriteup } from "./ratings";
import { writeups as bundled } from "virtual:tcab-snapshot";

// Resolve a run's review: a locally-previewed writeup (served from disk by the
// dev plugin for unpublished runs) takes precedence over the bundled, published
// one. Returns undefined when the run has no writeup at all.
export function findReview(
  runId: string,
  localWriteups?: Readonly<Record<string, string>>,
): ParsedWriteup | undefined {
  const raw = localWriteups?.[runId] ?? bundled[runId];
  return raw === undefined ? undefined : parseWriteup(raw);
}
