// The ArenaApi over Tauri IPC: matches and tournaments run in the embedded local
// core, with live tournament progress arriving on the two `tournament://` event
// channels. Mirrors `crates/desktop/src/arena.rs`. The per-match replays are
// served to the webview over the shell's `tcab-tournament://` scheme (see
// `crates/desktop/src/tournament.rs`).
import type { ControllerRef } from "@test-cabinet/run-record";
import type { ArenaApi } from "@test-cabinet/ui/app";
import * as api from "../api";

export function createTauriArena(): ArenaApi {
  return {
    // The desktop shell runs every match in its one embedded local core, so there
    // is a single fixed "worker"; the `workerId` the methods accept is ignored.
    listWorkers() {
      return [{ id: "local", label: "Local" }];
    },

    listControllers(slug, version): Promise<ControllerRef[]> {
      return api.listAdversarialControllers(slug, version);
    },

    runMatch(input) {
      return api.runAdversarialMatch({
        testCase: input.testCase,
        version: input.version,
        red: input.red,
        blue: input.blue,
      });
    },

    runTournament(input): Promise<string> {
      return api.runTournamentMatch({
        testCase: input.testCase,
        version: input.version,
        variant: input.variant,
        participants: input.participants,
      });
    },

    subscribeTournament(id, handlers): () => void {
      // Two channels carry the field: per-match progress and the terminal
      // outcome. Listen on both with the same cancelled-flag pattern the run
      // subscription uses, since `listen` resolves asynchronously.
      let unProgress: (() => void) | null = null;
      let unDone: (() => void) | null = null;
      let cancelled = false;
      const cleanup = () => {
        cancelled = true;
        unProgress?.();
        unDone?.();
      };
      api
        .listen<api.TournamentProgress>(
          api.tournamentProgressChannel(id),
          (p) => handlers.onProgress(p),
        )
        .then((u) => (cancelled ? u() : (unProgress = u)))
        .catch((err) => handlers.onError?.(err));
      api
        .listen<api.TournamentOutcome>(api.tournamentDoneChannel(id), (o) => {
          if (o.kind === "completed") handlers.onDone(o.record);
          else handlers.onDone(null, o.message);
          cleanup();
        })
        .then((u) => (cancelled ? u() : (unDone = u)))
        .catch((err) => handlers.onError?.(err));
      return cleanup;
    },

    listTournaments: () => api.listTournaments(),
    readTournament: (id) => api.readTournament(id),

    tournamentReplayUrl(tournamentId, matchId): string | null {
      return `tcab-tournament://localhost/${encodeURIComponent(tournamentId)}/${encodeURIComponent(matchId)}/replay.json`;
    },
  };
}
