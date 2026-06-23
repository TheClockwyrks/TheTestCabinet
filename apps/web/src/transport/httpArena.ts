// The ArenaApi over HTTP, against the single backend URL the console talks to:
// head-to-head matches and tournaments run there, with persisted tournaments and
// per-match replays read back from it. Since the per-run-Job refactor there is no
// separate worker the arena runs on — the backend is the one host for both the run
// and read methods. The shared gallery degrades the UI when the capability is
// absent.
import type {
  ControllerRef,
  MatchSummary,
  TournamentRecord,
} from "@test-cabinet/run-record";
import type { ArenaApi, ArenaWorkerOption } from "@test-cabinet/ui/app";
import { getJson, joinUrl, postJson } from "./http";

// The backend's `POST /tournaments` ack: the id plus the URLs to observe it.
interface TournamentAck {
  tournamentId: string;
  statusUrl: string;
  eventsUrl: string;
}

// The backend's `GET /tournaments/{id}` status. On success it already carries the
// finished record, so the subscriber reads it straight off this — no second fetch
// (and no read-after-publish race).
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
 * Build the web host's arena capability against the single backend URL it talks
 * to. Both the run methods (matches/tournaments) and the read methods (persisted
 * tournaments + replays) target `backendUrl`. The optional `workerId` on each call
 * is vestigial — there is one execution host now — so it is ignored. The gallery
 * only offers the run UI when both `canExecute` and the arena are present.
 */
export function createHttpArena(backendUrl: string): ArenaApi {
  return {
    listWorkers(): ArenaWorkerOption[] {
      // A single execution host (the backend); kept as a one-entry list so the
      // arena's worker dropdown still renders a (fixed) choice.
      return [{ id: "backend", label: "Backend" }];
    },

    async listControllers(slug): Promise<ControllerRef[]> {
      const { controllers } = await getJson<{ controllers: ControllerRef[] }>(
        backendUrl,
        `/matches/controllers?testCase=${encodeURIComponent(slug)}`,
      );
      return controllers;
    },

    runMatch(
      input,
    ): Promise<{ replay: unknown | null; summary: MatchSummary }> {
      return postJson<{ replay: unknown | null; summary: MatchSummary }>(
        backendUrl,
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
      const ack = await postJson<TournamentAck>(backendUrl, "/tournaments", {
        testCase: input.testCase,
        version: input.version,
        variant: input.variant,
        participants: input.participants,
      });
      return ack.tournamentId;
    },

    subscribeTournament(id, handlers): () => void {
      const controller = new AbortController();
      void streamTournament(backendUrl, id, handlers, controller);
      return () => controller.abort();
    },

    async listTournaments(): Promise<TournamentRecord[]> {
      const page = await getJson<TournamentListPage>(
        backendUrl,
        "/tournaments",
      );
      return page.tournaments.map((entry) => entry.record);
    },

    async readTournament(id): Promise<TournamentRecord> {
      const { record } = await getJson<PublishedTournament>(
        backendUrl,
        `/tournaments/${encodeURIComponent(id)}`,
      );
      return record;
    },

    tournamentReplayUrl(tournamentId, matchId): string | null {
      return joinUrl(
        backendUrl,
        `/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}/replay.json`,
      );
    },
  };
}

// Consume the backend's NDJSON `/tournaments/{id}/events` progress stream, then
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
      {
        headers: { accept: "application/x-ndjson" },
        signal: controller.signal,
      },
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
      handlers.onDone(
        null,
        status.detail ?? "The tournament did not complete.",
      );
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
