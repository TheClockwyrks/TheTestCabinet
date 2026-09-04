// The browser half of the scenario file API (`../scenario-api.ts`): list, read and
// write the Lattice case's committed scenarios.
//
// The API only exists under `vite dev`. A statically built bundle has no server to
// talk to, so `listScenarios` resolves to `null` there rather than throwing, and the
// UI hides the open/save controls and falls back to export/download.

/** What the picker shows for one scenario file, without loading the whole thing. */
export interface ScenarioSummary {
  /** The file stem (`medium` for `cases/medium.json`) — also its API id. */
  name: string;
  ticks: number;
  snapshots: number[];
  grid: { width: number; height: number };
  entities: number;
}

const ROUTE = "/api/scenarios";

/**
 * Every scenario the dev server exposes, or `null` when there is no dev server
 * (a static build, or the plugin is not mounted). A `null` means "this build cannot
 * open files", which the UI treats as a mode rather than an error.
 */
export async function listScenarios(): Promise<ScenarioSummary[] | null> {
  let response: Response;
  try {
    response = await fetch(ROUTE);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return Array.isArray(body) ? (body as ScenarioSummary[]) : null;
}

/** One scenario's parsed JSON, straight from the file on disk. */
export async function readScenario(name: string): Promise<unknown> {
  const response = await fetch(`${ROUTE}/${name}`);
  if (!response.ok) throw new Error(await errorText(response));
  return response.json();
}

/**
 * Overwrite a scenario file with `text`. The text is stored verbatim, so the caller
 * owns the formatting — pass `exportJson`'s output to match the committed style.
 */
export async function writeScenario(
  name: string,
  text: string,
): Promise<void> {
  const response = await fetch(`${ROUTE}/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!response.ok) throw new Error(await errorText(response));
}

/** The server's `{ error }` detail, falling back to the status line. */
async function errorText(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // fall through to the status line
  }
  return `${response.status} ${response.statusText}`;
}
