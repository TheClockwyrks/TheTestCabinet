// Coil — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Coil's whole part is to name the values it
// wants on it, registered through `world.diagnostics` from the game mode's
// `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every one
// is a PURE READ of the live state it reaches through the given accessor — the
// world the mode holds — so the panel reports the frame being drawn and watching
// the overlay never changes what the simulation does. Each line is short enough
// to read at a glance while the game runs.

import { COMBO_WINDOW } from "./constants";
import { coilState, type CoilState } from "./game";
import type { DiagnosticValue, World } from "@clockwyrks/structured-2d";

function cell(
  value: { readonly col: number; readonly row: number } | null,
): string {
  return value ? `${value.col}, ${value.row}` : "none";
}

/**
 * The sources, each named and each a read through `read` at the call. Split from
 * the registration so the build's tests can drive the same sources over a state
 * of their own.
 */
export function diagnosticSources(
  read: () => CoilState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => read().screen],
    ["score", () => read().score],
    ["best", () => read().best],
    ["combo", () => `x${read().combo}`],
    [
      "window",
      () => `${read().comboWindow.toFixed(2)} / ${COMBO_WINDOW.toFixed(2)} s`,
    ],
    ["dir", () => read().dir],
    ["length", () => read().snake.length],
    ["head", () => cell(read().snake[0] ?? null)],
    ["pellet", () => cell(read().pellet)],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => coilState(world))) {
    world.diagnostics.register(name, source);
  }
}
