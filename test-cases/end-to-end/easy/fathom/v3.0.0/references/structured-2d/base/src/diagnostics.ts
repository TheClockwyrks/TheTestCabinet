// Fathom — the values the engine's debug overlay shows.
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Fathom's whole part is to name the values
// it wants on it (`specs/instrumentation.md`, Diagnostics), registered through
// `world.diagnostics` from the game mode's `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor, so
// the panel reports the frame being drawn and watching it never changes what the
// simulation does. Each line is short enough to read at a glance while the game
// runs, and the predator lines are one per den slot rather than one per live
// hunter, so the panel keeps its shape as a deeper maze adds to the roster.

import type { DiagnosticValue, World } from "@test-cabinet/structured-2d";
import { DEN_ORDER, ROSTER_CAP } from "./constants";
import { sonarRange } from "./flow";
import { bodyCell } from "./movement";
import { fathomState, type FathomState } from "./game";

/** As many lines as the deepest roster holds: two of each of the three kinds. */
const PREDATOR_LINES = DEN_ORDER.length * ROSTER_CAP;

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests can drive the same sources over a
 * state of their own.
 */
export function diagnosticSources(
  read: () => FathomState,
): [string, () => DiagnosticValue][] {
  const sources: [string, () => DiagnosticValue][] = [
    ["screen", () => `${read().screen}  depth ${read().depth}`],
    ["score", () => `${read().score}  lives ${read().lives}`],
    [
      "light",
      () => {
        const { forager } = read();
        return `G ${forager.brightness.toFixed(2)}  V ${Math.round(forager.visionRadius)}`;
      },
    ],
    [
      "cooldowns",
      () => {
        const state = read();
        return (
          `sonar ${state.sonarCooldown.toFixed(2)}s / E ${sonarRange(state.depth)}` +
          `  ink ${state.inkCooldown.toFixed(2)}s`
        );
      },
    ],
    ["plankton", () => read().planktonRemaining],
    [
      "forager",
      () => {
        const state = read();
        const cell = bodyCell(state.forager);
        return (
          `(${cell.tx}, ${cell.ty}) ${state.forager.facing}` +
          (state.forager.heading === null ? " at rest" : " moving")
        );
      },
    ],
  ];

  for (let slot = 0; slot < PREDATOR_LINES; slot++) {
    sources.push([
      `predator ${slot}`,
      () => {
        const predator = read().predators[slot];
        if (!predator) return "-";
        const cell = bodyCell(predator);
        return (
          `${predator.kind} ${predator.state} (${cell.tx}, ${cell.ty})` +
          ` ${Math.round(predator.speed)}` +
          (predator.alert > 0 ? " ALERT" : "")
        );
      },
    ]);
  }

  return sources;
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => fathomState(world))) {
    world.diagnostics.register(name, source);
  }
}
