// Facet — the values the runtime's debug overlay shows.
//
// The overlay itself is the runtime's (src/overlay.ts): it owns the panel, the
// backtick key that toggles it, and its read-only-ness. Facet's whole part is
// to name the values it wants on it (specs/instrumentation.md, Diagnostics),
// which is what this file does — and the set below is exactly the set that file
// asks for: the screen and phase, the board's dimensions, the score, the level
// and its score against the target, the chain step and multiplier, what the
// most recent step cleared and scored, its `lastWaves` and its `lastFall`, the
// selected cell and the offered cell, the level's best move and longest chain,
// whether a legal swap exists, and the pointer with the device driving it.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the runtime passes in because the
// state is a value that every frame replaces. Nothing is closed over, so
// watching the overlay never changes what the simulation does, and each line is
// short enough to read at a glance while the game runs.

import { lastFall, legalSwapExists, levelTarget, multiplierFor } from "./core";
import type { InitApi } from "./runtime";
import type { Cell, FacetState } from "./core";

/** A cell as one short line, or a dash where there is none to report. */
function cellLine(cell: Cell | null): string {
  return cell === null ? "-" : `${cell.col},${cell.row}`;
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<FacetState>, "diagnostics">,
): void {
  api.diagnostics.register(
    "screen",
    (state) => `${state.screen} / ${state.phase}`,
  );
  api.diagnostics.register(
    "board",
    (state) => `${state.board.cols}x${state.board.rows}`,
  );
  api.diagnostics.register("score", (state) => state.score);
  api.diagnostics.register(
    "level",
    (state) =>
      `${state.level}  ${state.levelScore}/${levelTarget(state.level)}`,
  );
  api.diagnostics.register(
    "chain",
    (state) => `step ${state.chainStep}  x${multiplierFor(state.chainStep)}`,
  );
  api.diagnostics.register(
    "last step",
    (state) => `${state.lastCleared} cells  ${state.lastPoints} pts`,
  );
  api.diagnostics.register(
    "waves / fall",
    (state) => `${state.lastWaves}  ${lastFall(state.board)}`,
  );
  api.diagnostics.register("selection", (state) => cellLine(state.selection));
  api.diagnostics.register("offer", (state) => cellLine(state.offer));
  api.diagnostics.register(
    "best",
    (state) => `move ${state.bestMove}  chain ${state.bestChain}`,
  );
  api.diagnostics.register("legal swap", (state) =>
    legalSwapExists(state.board),
  );
  api.diagnostics.register(
    "pointer",
    (state) =>
      `${state.pointer.x.toFixed(0)}, ${state.pointer.y.toFixed(0)} ` +
      `${state.pointer.device}${state.pointer.down ? " down" : ""}`,
  );
}
