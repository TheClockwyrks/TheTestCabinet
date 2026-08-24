// Refract — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Refract's whole part is to name the
// values it wants on it (specs/instrumentation.md, Diagnostics), which is what
// this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the
// state is a value that every frame replaces. Nothing is closed over, so
// watching the overlay never changes what the simulation does, and each line
// is short enough to read at a glance while the game runs.

import { CHANNELS } from "./constants";
import { beamComplete, boardSolved, spentAt } from "./rules";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { RefractState } from "./game";

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<RefractState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("mode", (state) => state.mode);
  api.diagnostics.register(
    "board",
    (state) => `${state.board.cols}x${state.board.rows}`,
  );
  for (const channel of CHANNELS) {
    api.diagnostics.register(`beam ${channel}`, (state) => {
      const beam = state.beams.find((entry) => entry.channel === channel);
      if (!beam) return "-";
      const segments = Math.max(0, beam.cells.length - 1);
      return `${segments} seg${beamComplete(state.board, beam) ? ", complete" : ""}`;
    });
  }
  api.diagnostics.register("crystals", (state) => {
    const crystals = state.board.nodes.filter(
      (node) => node.kind === "crystal",
    );
    if (crystals.length === 0) return "-";
    return crystals
      .map((node) => `${spentAt(state.beams, node)}/${node.charges}`)
      .join(" ");
  });
  api.diagnostics.register("solved", (state) =>
    boardSolved(state.board, state.beams),
  );
  api.diagnostics.register(
    "pointer",
    (state) =>
      `${state.pointer.x.toFixed(0)}, ${state.pointer.y.toFixed(0)}` +
      (state.pointer.down ? " down" : ""),
  );
}
