// Shatter — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Shatter's whole part is to name the
// values it wants on it (`specs/instrumentation.md`, Diagnostics), registered
// through `world.diagnostics` from the game mode's `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor —
// the world the mode holds — so the panel reports the frame being drawn and
// watching the overlay never changes what the simulation does. Each line is
// short enough to read at a glance while the game runs.

import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";
import { shatterState, type ShatterState } from "./game";

/** A pair of figures as one short reading. */
function pair(x: number, y: number): string {
  return `${x.toFixed(0)}, ${y.toFixed(0)}`;
}

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests drive the same sources over a
 * state of their own.
 */
export function diagnosticSources(
  read: () => ShatterState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => read().screen],
    ["score", () => read().score],
    ["lives", () => read().lives],
    ["wave", () => read().wave],
    ["ship", () => pair(read().ship.x, read().ship.y)],
    ["ship v", () => pair(read().ship.vx, read().ship.vy)],
    [
      "ship speed",
      () => {
        const ship = read().ship;
        return Math.hypot(ship.vx, ship.vy);
      },
    ],
    [
      "ship facing",
      () => `${((read().ship.angle * 180) / Math.PI).toFixed(0)} deg`,
    ],
    ["invuln", () => read().ship.invuln],
    ["bullets", () => read().bullets.length],
    ["rocks", () => read().rocks.length],
    [
      "saucer",
      () => {
        const saucer = read().saucer;
        return saucer === null
          ? "-"
          : `#${saucer.id} ${pair(saucer.x, saucer.y)}`;
      },
    ],
    ["sim time", () => read().simTime],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => shatterState(world))) {
    world.diagnostics.register(name, source);
  }
}
