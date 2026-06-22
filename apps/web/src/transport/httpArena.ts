// The ArenaApi over HTTP: head-to-head matches and tournaments run on the active
// worker, with persisted tournaments and per-match replays read from the backend
// (the worker auto-publishes a finished tournament there). Run methods need the
// worker; the read methods need the backend — a host wires whichever base URLs it
// has, and the shared gallery degrades the UI when the capability is absent.
import type {
  ControllerRef,
  MatchSummary,
  TournamentRecord,
} from "@test-cabinet/run-record";
import type { ArenaApi, ArenaWorkerOption } from "@test-cabinet/ui/app";
import { getJson, joinUrl, postJson } from "./http";

/** One worker the arena can run on: its identity plus its base URL. */
export interface ArenaWorker extends ArenaWorkerOption {
  /** The worker's base URL (web workers are always remote, so never null here). */
  url: string | null;
}

// The worker's `POST /tournaments` ack: the id plus the URLs to observe it.
interface TournamentAck {
  tournamentId: string;
  statusUrl: string;
  eventsUrl: string;
}

// The worker's `GET /tournaments/{id}` status. On success it already carries the
// finished record, so the subscriber reads it straight off this — no second fetch
// (and no read-after-publish race against the backend).
interface TournamentStatus {
  id: string;
  state: "running" | "succeeded" | "failed";
  record?: TournamentRecord;
  detail?: string;
}

// One backend-listed tournament: the record plus when it was published.
interface PublishedTournament {
  record: TournamentRecord;
  publishedAt: string;
}

interface TournamentListPage {
  tournaments: PublishedTournament[];
  nextBefore: string | null;
}

/**
 * Build the web host's arena capability from the workers and backend it currently
 * holds. `workers` is every configured worker (each with its base URL); `activeId`
 * is the worker a call defaults to when none is named; `backendUrl` is the backend
 * (or null). A run resolves the worker by the call's `workerId` (or the active
 * worker), and rejects when none is connected; the read methods reject without a
 * backend. The gallery only offers the run UI when both `canExecute` and the arena
 * are present, so the rejections back a clear failure rather than a silent no-op.
 */
export function createHttpArena(
  workers: ArenaWorker[],
  activeId: string | null,
  backendUrl: string | null,
): ArenaApi {
  // Resolve a call's worker base URL: the named worker, else the active one.
  const workerUrl = (workerId?: string): string | null => {
    const id = workerId ?? activeId;
    const worker = workers.find((w) => w.id === id) ?? null;
    return worker?.url ?? null;
  };
  const requireWorker = (workerId?: string): string => {
    const base = workerUrl(workerId);
    if (!base) throw new Error("No worker connected to run the arena on.");
    return base;
  };

  return {
    listWorkers(): ArenaWorkerOption[] {
      return workers.map((w) => ({ id: w.id, label: w.label }));
    },

    async listControllers(slug, _version, workerId): Promise<ControllerRef[]> {
      const base = requireWorker(workerId);
      const { controllers } = await getJson<{ controllers: ControllerRef[] }>(
        base,
        `/matches/controllers?testCase=${encodeURIComponent(slug)}`,
      );
      return controllers;
    },

    runMatch(input): Promise<{ replay: unknown | null; summary: MatchSummary }> {
      const base = requireWorker(input.workerId);
      return postJson<{ replay: unknown | null; summary: MatchSummary }>(
        base,
        "/matches",
        {
          testCase: input.testCase,
          version: input.version,
          red: input.red,
          blue: input.blue,
        },
      );
    },

    async runTournament(input): Promise<string> {
      const base = requireWorker(input.workerId);
      const ack = await postJson<TournamentAck>(base, "/tournaments", {
        testCase: input.testCase,
        version: input.version,
        variant: input.variant,
        participants: input.participants,
      });
      return ack.tournamentId;
    },

    subscribeTournament(id, handlers, workerId): () => void {
      const base = workerUrl(workerId);
      if (!base) {
        handlers.onDone(null, "No worker connected to run the arena on.");
        return () => {};
      }
      const controller = new AbortController();
      void streamTournament(base, id, handlers, controller);
      return () => controller.abort();
    },

    async listTournaments(): Promise<TournamentRecord[]> {
      if (!backendUrl) return [];
      const page = await getJson<TournamentListPage>(
        backendUrl,
        "/tournaments",
      );
      return page.tournaments.map((entry) => entry.record);
    },

    async readTournament(id): Promise<TournamentRecord> {
      if (!backendUrl) {
        throw new Error("No backend configured to read tournaments from.");
      }
      const { record } = await getJson<PublishedTournament>(
        backendUrl,
        `/tournaments/${encodeURIComponent(id)}`,
      );
      return record;
    },

    tournamentReplayUrl(tournamentId, matchId): string | null {
      if (!backendUrl) return null;
      return joinUrl(
        backendUrl,
        `/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}/replay.json`,
      );
    },
  };
}

// Consume the worker's NDJSON `/tournaments/{id}/events` progress stream, then
// read the terminal status back. The status response already carries the finished
// record on success, so the subscriber resolves it straight from there.
async function streamTournament(
  baseUrl: string,
  id: string,
  handlers: Parameters<ArenaApi["subscribeTournament"]>[1],
  controller: AbortController,
): Promise<void> {
  try {
    const res = await fetch(
      joinUrl(baseUrl, `/tournaments/${encodeURIComponent(id)}/events`),
      { headers: { accept: "application/x-ndjson" }, signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      throw new Error(`tournament event stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) emitProgress(line, handlers);
      }
    }
    const tail = buffer.trim();
    if (tail) emitProgress(tail, handlers);

    // The stream closes when the field finishes; read the terminal status back.
    const status = await getJson<TournamentStatus>(
      baseUrl,
      `/tournaments/${encodeURIComponent(id)}`,
    );
    if (status.state === "succeeded" && status.record) {
      handlers.onDone(status.record);
    } else {
      handlers.onDone(null, status.detail ?? "The tournament did not complete.");
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    handlers.onError?.(e);
  }
}

function emitProgress(
  line: string,
  handlers: Parameters<ArenaApi["subscribeTournament"]>[1],
): void {
  try {
    const parsed = JSON.parse(line) as {
      played: number;
      total: number;
      summary: MatchSummary;
    };
    handlers.onProgress(parsed);
  } catch {
    // A malformed progress line shouldn't tear down the stream; skip it.
  }
}
