// Where the console reaches the services it does not talk to through the backend.
//
// The console is served at one origin per environment, and every service it
// uses is a path of that origin: the edge routes `/api/` to the backend,
// `/artifacts/` to the artifacts service and `/arena/` to the arena service
// (components/web/overview.md, "Service dependencies"). In development the Vite
// dev server proxies the same three paths, so the paths are the same everywhere
// and nothing is fetched to learn them.
//
// Two addresses are not paths of the origin: Grafana and the public snapshot
// bucket. Each is a sibling hostname of the console's, its leading `console.`
// label replaced (`grafana.testcabinet.ai` beside `console.testcabinet.ai`,
// `grafana.staging.testcabinet.ai` beside `console.staging.testcabinet.ai`; see
// development/observability.md). A host whose name does not begin with
// `console.` (the dev server on 127.0.0.1, the public gallery) has neither, and
// the surfaces that link to them are not offered there.

/** The path of the console's origin the artifacts service is served under. */
export const ARTIFACTS_PATH = "/artifacts";

/** The path of the console's origin the arena service is served under. */
export const ARENA_PATH = "/arena";

/** The leading label of every console hostname. */
const CONSOLE_LABEL = "console.";

/**
 * The `https://` origin of the sibling of a console `hostname` whose leading
 * `console.` label is replaced by `label`, or null when the hostname is not a
 * console's.
 */
function siblingOrigin(hostname: string, label: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host.startsWith(CONSOLE_LABEL)) return null;
  const rest = host.slice(CONSOLE_LABEL.length);
  // A bare `console.` has no domain to be a sibling in.
  return rest ? `https://${label}.${rest}` : null;
}

/**
 * Grafana's base URL for the console served at `hostname`: the hostname with its
 * leading `console.` label replaced by `grafana.`, or null on any other host,
 * which has no Grafana behind the edge to link to.
 */
export function grafanaUrlForHost(hostname: string): string | null {
  return siblingOrigin(hostname, "grafana");
}

/**
 * The public snapshot bucket's read base for the console served at `hostname`:
 * the hostname with its leading `console.` label replaced by `snapshot.`, the
 * bucket's public hostname in each environment, or null on any other host, where
 * a case's published asset-reference frames are not offered.
 */
export function snapshotUrlForHost(hostname: string): string | null {
  return siblingOrigin(hostname, "snapshot");
}

/** The hostname the page was served from, or "" outside a browser. */
export function currentHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}
