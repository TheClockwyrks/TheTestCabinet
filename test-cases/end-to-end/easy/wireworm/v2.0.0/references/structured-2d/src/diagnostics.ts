// Wireworm — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Wireworm's whole part is to name the
// values it wants on it (`specs/instrumentation.md`, Diagnostics), registered
// through `world.diagnostics` from the game mode's `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor —
// the world the mode holds — so the panel reports the frame being drawn and
// watching the overlay never changes what the simulation does. Each line is
// short enough to read at a glance while the game runs.

import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";
import { TOTAL_LEVELS } from "./constants";
import { wirewormState, type WirewormState } from "./game";

/** A heading as `+1` right / `-1` left reads on one line. */
function heading(dh: number, dv: number): string {
  return `${dh > 0 ? "R" : "L"}${dv > 0 ? "D" : "U"}`;
}

/**
 * The sources, each named and each a read through `read` at the call. Split from
 * the registration so the build's tests can drive the same sources over a state
 * of their own.
 */
export function diagnosticSources(
  read: () => WirewormState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => `${read().screen} / ${read().phase}`],
    ["score", () => read().score],
    ["lives", () => read().lives],
    ["level", () => `${read().level} / ${TOTAL_LEVELS}`],
    ["nodes", () => read().nodes.length],
    [
      "worms",
      () => {
        const worms = read().worms;
        if (worms.length === 0) return "-";
        return worms
          .map((worm) => {
            const head = worm.segments[0];
            const at = head ? `${head.c},${head.r}` : "-";
            const dive = worm.diving ? " dive" : "";
            return `#${worm.id} x${worm.segments.length} @${at} ${heading(worm.dh, worm.dv)}${dive}`;
          })
          .join("  ");
      },
    ],
    [
      "foes",
      () => {
        const foes = read().foes;
        if (foes.length === 0) return "-";
        return foes
          .map(
            (foe) =>
              `#${foe.id} ${foe.kind} ${foe.x.toFixed(0)},${foe.y.toFixed(0)}`,
          )
          .join("  ");
      },
    ],
    [
      "cursor",
      () => {
        const { cursor } = read();
        return `${cursor.x.toFixed(0)}, ${cursor.y.toFixed(0)}`;
      },
    ],
    ["bolts", () => read().bolts.length],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => wirewormState(world))) {
    world.diagnostics.register(name, source);
  }
}
