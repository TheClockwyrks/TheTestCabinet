// Kessler — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key
// that toggles it, and its read-only-ness. Kessler's whole part is to name
// the values it wants on it, registered through `world.diagnostics` from the
// game mode's `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor
// — the world the mode holds — so the panel reports the frame being drawn and
// watching the overlay never changes what the simulation does. Each line is
// short enough to read at a glance while the game runs.

import { FxActor } from "./actors";
import { kesslerState, type KesslerState } from "./state";
import { spanOf } from "./session";
import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests can drive the same sources over
 * a state of their own.
 */
export function diagnosticSources(
  read: () => KesslerState,
): [string, () => DiagnosticValue][] {
  return [
    ["screen", () => read().screen],
    ["score", () => read().score],
    ["lives", () => read().lives],
    ["wave", () => read().wave],
    [
      "paddle",
      () => `${read().paddleAngleDeg.toFixed(1)} deg / ${spanOf(read())} deg`,
    ],
    ["balls", () => read().balls.length],
    [
      "targets",
      () =>
        read().rings.reduce(
          (count, ring) =>
            count + ring.targets.filter((hp) => hp !== null).length,
          0,
        ),
    ],
    ["pods", () => read().pods.length],
    ["widen", () => `${read().effects.widenTicks} ticks`],
    ["narrow", () => `${read().effects.narrowTicks} ticks`],
    ["pierce", () => `${read().effects.pierceTicks} ticks`],
    ["shield", () => (read().effects.shieldActive ? "active" : "down")],
    ["ticks", () => read().ticks],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => kesslerState(world))) {
    world.diagnostics.register(name, source);
  }
  world.diagnostics.register("fx", () => world.find(FxActor)?.fx.count ?? 0);
}
