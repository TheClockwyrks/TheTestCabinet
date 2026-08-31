// Facet — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, the formatting, and its read-only-ness. Facet's whole part is to
// name the values it wants on it (specs/instrumentation.md, Diagnostics), which
// is what this file does — and the set below is exactly the set that file asks
// for: the screen and the phase, the board's dimensions, the score, the level
// and its score against the target, the chain step and multiplier, what the most
// recent step cleared and scored, the cursor and the selection, whether a legal
// swap exists, and the pointer.
//
// Every source is a PURE READ of the state it is HANDED — the state current at
// the moment the overlay reads it, which the engine passes in because the state
// is a value every frame replaces. Nothing is closed over, so a source cannot
// report the opening state forever and watching the overlay never changes what
// the simulation does. Each line is short enough to read while the game runs.

import { toCoreBoard } from "./bridge";
import { legalSwapExists, levelTarget, multiplierFor } from "./core";
import type { FacetState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

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
    "cursor",
    (state) => `${state.cursor.col},${state.cursor.row}`,
  );
  api.diagnostics.register("selection", (state) =>
    state.selection ? `${state.selection.col},${state.selection.row}` : "-",
  );
  api.diagnostics.register("legal swap", (state) =>
    legalSwapExists(toCoreBoard(state.board)),
  );
  api.diagnostics.register(
    "pointer",
    (state) =>
      `${state.pointer.x.toFixed(0)}, ${state.pointer.y.toFixed(0)}` +
      (state.pointer.down ? " down" : ""),
  );
}
