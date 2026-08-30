// Coil — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Coil's whole part is to name the values it
// wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the state is
// a value that every frame replaces. Nothing is closed over, so watching the
// overlay never changes what the simulation does, and each line is short enough to
// read at a glance while the game runs.

import { COMBO_WINDOW } from "./constants";
import type { CoilState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

function cell(
  value: { readonly col: number; readonly row: number } | null,
): string {
  return value ? `${value.col}, ${value.row}` : "none";
}

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<CoilState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("score", (state) => state.score);
  api.diagnostics.register("best", (state) => state.best);
  api.diagnostics.register("combo", (state) => `x${state.combo}`);
  api.diagnostics.register(
    "window",
    (state) => `${state.comboWindow.toFixed(2)} / ${COMBO_WINDOW.toFixed(2)} s`,
  );
  api.diagnostics.register("dir", (state) => state.dir);
  api.diagnostics.register("length", (state) => state.snake.length);
  api.diagnostics.register("head", (state) => cell(state.snake[0] ?? null));
  api.diagnostics.register("pellet", (state) => cell(state.pellet));
}
