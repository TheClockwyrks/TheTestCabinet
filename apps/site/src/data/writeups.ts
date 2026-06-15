// Curated implementation reviews. A review is an optional, hand-written note
// shown on a run's page before its playable build is launched (see
// docs/site.md#implementation-writeups). It carries a quality rating in its
// frontmatter and a Markdown body; neither is part of the run record. Reviews
// live as `writeups/<runId>.md` and are published alongside the record, so the
// gallery bundles whatever files are present at build time.
import { type ParsedWriteup, parseWriteup } from "./ratings";

const writeupModules = import.meta.glob("./writeups/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Key each writeup by its run id, taken from the Markdown file's base name.
const bundled: Record<string, string> = {};
for (const [path, content] of Object.entries(writeupModules)) {
  const runId = path.replace(/^.*\/(.+)\.md$/, "$1");
  bundled[runId] = content;
}

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
