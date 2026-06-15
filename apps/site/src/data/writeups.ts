// Curated implementation writeups. A writeup is an optional, hand-written
// Markdown note shown on a run's page before its playable build is launched
// (see docs/site.md#implementation-writeups). Writeups are NOT part of the run
// record; they live as `writeups/<runId>.md` and are published alongside the
// record. The gallery bundles whatever files are present at build time.
const writeupModules = import.meta.glob("./writeups/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Key each writeup by its run id, taken from the Markdown file's base name.
const writeups: Record<string, string> = {};
for (const [path, content] of Object.entries(writeupModules)) {
  const runId = path.replace(/^.*\/(.+)\.md$/, "$1");
  writeups[runId] = content;
}

export function findWriteup(runId: string): string | undefined {
  return writeups[runId];
}
