// Typed wrappers over the Tauri commands the desktop shell exposes.
//
// Since the desktop became a thin backend client (it enqueues and watches runs
// over the same HTTP API the web console uses — see `state/useConnections.ts`),
// IPC is reserved for the two things that are genuinely host concerns: the
// shell's resolved service URLs (so the webview can build its HTTP transports
// against the backend the shell is configured for) and the **local arena**, whose
// adversarial matches and tournaments run in the embedded core in-process.
//
// Tauri's `invoke`/`listen` are imported lazily so the bundle still loads in a
// plain browser (where the commands are absent) for development; `isTauri` gates
// the calls.
import type {
  ControllerRef,
  MatchSummary,
  TournamentRecord,
} from "@test-cabinet/run-record";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

// --- Shell configuration ----------------------------------------------------

// The desktop shell's resolved service URLs, read from its environment
// (`TCAB_BACKEND_URL` / `TCAB_AUTH_URL`). The webview builds its HTTP transports
// against these — the same `createHttpBackend`/`createBackendExec` the web console
// uses — so the desktop talks to the backend directly rather than through IPC.
export const appVersion = () => invoke<string>("app_version");
// The backend the shell is configured for, or `null` when unset; the webview is
// "unconfigured" until one is present.
export const backendUrl = () => invoke<string | null>("backend_url");
// The auth service the shell registers/logs in against (always resolves, falling
// back to the loopback default for local dev).
export const authUrl = () => invoke<string>("auth_url");

// --- Adversarial arena ------------------------------------------------------

// A quick (transient) head-to-head match configuration. The command arg is keyed
// `config`, matching `run_adversarial_match(config: MatchConfig)`.
export interface MatchConfig {
  testCase: string;
  version: string;
  red: ControllerRef;
  blue: ControllerRef;
}

// The quick match's result: the replay (for immediate playback) and the summary.
export interface MatchResult {
  replay: unknown | null;
  summary: MatchSummary;
}

// A tournament configuration, keyed `config` to match
// `run_tournament_match(app, config: TournamentConfig)`.
export interface TournamentConfig {
  testCase: string;
  version: string;
  variant: string;
  participants: ControllerRef[];
}

// One completed match emitted live on a tournament's progress channel.
export interface TournamentProgress {
  played: number;
  total: number;
  summary: MatchSummary;
}

// A tournament's terminal outcome, emitted on its done channel.
export type TournamentOutcome =
  | { kind: "completed"; record: TournamentRecord }
  | { kind: "failed"; message: string };

export const runAdversarialMatch = (config: MatchConfig) =>
  invoke<MatchResult>("run_adversarial_match", { config });
export const listAdversarialControllers = (slug: string, version: string) =>
  invoke<ControllerRef[]>("list_adversarial_controllers", { slug, version });
export const runTournamentMatch = (config: TournamentConfig) =>
  invoke<string>("run_tournament_match", { config });
export const listTournaments = () =>
  invoke<TournamentRecord[]>("list_tournaments");
export const readTournament = (id: string) =>
  invoke<TournamentRecord>("read_tournament", { id });

// A tournament's live per-match progress and terminal outcome channels — mirror
// `crates/desktop/src/arena.rs`'s `progress_channel`/`done_channel`.
export const tournamentProgressChannel = (id: string) =>
  `tournament://${id}/progress`;
export const tournamentDoneChannel = (id: string) => `tournament://${id}/done`;
