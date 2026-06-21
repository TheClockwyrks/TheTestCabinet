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
import type { ArenaApi } from "@test-cabinet/ui/app";
import { getJson, joinUrl, postJson } from "./http";

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
 * Build the web host's arena capability from the base URLs it currently holds.
 * `workerUrl` is the active worker (or null when none is connected); `backendUrl`
 * is the backend (or null). The run methods reject without a worker; the read
 * methods reject without a backend. The gallery only offers the run UI when both
 * `canExecute` and the arena are present, so the rejections back a clear failure
 * rather than a silent no-op.
 */
export function createHttpArena(
  workerUrl: string | null,
  backendUrl: string | null,
): ArenaApi {
  const requireWorker = (): string => {
    if (!workerUrl) throw new Error("No worker connected to run the arena on.");
    return workerUrl;
  };

  return {
    async listControllers(slug): Promise<ControllerRef[]> {
      const base = requireWorker();
      const { controllers } = await getJson<{ controllers: ControllerRef[] }>(
        base,
        `/matches/controllers?testCase=${encodeURIComponent(slug)}`,
      );
      return controllers;
    },

    runMatch(input): Promise<{ replay: unknown | null; summary: MatchSummary }> {
      const base = requireWorker();
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
      const base = requireWorker();
      const ack = await postJson<TournamentAck>(base, "/tournaments", {
        testCase: input.testCase,
        version: input.version,
        variant: input.variant,
        participants: input.participants,
      });
      return ack.tournamentId;
    },

    subscribeTournament(id, handlers): () => void {
      const base = workerUrl;
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
