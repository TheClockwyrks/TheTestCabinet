// Orrery — the values the engine's debug overlay shows
// (specs/instrumentation.md, Diagnostics).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Orrery's whole part is to NAME the values
// it wants on it, registered through `world.diagnostics` from the game mode's
// `beginPlay`.
//
// Every source is a function of no arguments, invoked at each read, and every
// one is a PURE READ of the live state it reaches through the given accessor —
// the world the mode holds — so the panel reports the frame being drawn and
// watching the overlay never changes what the simulation does. Each line is
// short enough to read at a glance while the game runs.

import type { World } from "@test-cabinet/structured-2d";
import { FxActor } from "./actors";
import { challengeCount } from "./challenges";
import { machinePeriod } from "./machine";
import { machineCost } from "./parts";
import { orreryState, type OrreryState } from "./state";

/** What a source that has nothing to report says. */
const DASH = "—";

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests can drive the same sources over a
 * state of their own.
 */
export function diagnosticSources(
  read: () => OrreryState,
): [string, () => string][] {
  return [
    ["screen", () => read().screen],
    ["mode", () => read().mode],
    ["challenge", () => read().challenge?.name ?? DASH],
    [
      "source",
      () => {
        const state = read();
        if (state.challenge === null) return DASH;
        const ref = state.challengeRef;
        return ref === null ? "custom" : `${ref.mode} ${ref.index + 1}`;
      },
    ],
    ["parts", () => String(read().editor.parts.length)],
    ["cost", () => String(machineCost(read().editor.parts))],
    ["period", () => String(machinePeriod(read().editor.parts))],
    ["status", () => read().sim?.status ?? DASH],
    [
      "cycle",
      () => {
        const sim = read().sim;
        return sim === null ? DASH : String(sim.cycle);
      },
    ],
    [
      "fraction",
      () => {
        const sim = read().sim;
        return sim === null ? DASH : sim.fraction.toFixed(3);
      },
    ],
    [
      "speed",
      () => {
        const sim = read().sim;
        return sim === null ? DASH : String(sim.speed);
      },
    ],
    [
      "tallies",
      () => {
        const state = read();
        const challenge = state.challenge;
        if (state.sim === null || challenge === null) return DASH;
        return state.sim.tallies
          .map((tally) => `${tally}/${challenge.target}`)
          .join(" ");
      },
    ],
    ["motes", () => String(read().sim?.motes.length ?? 0)],
    ["area", () => String(read().sim?.areaHexes.length ?? 0)],
    ["fault", () => read().sim?.fault?.kind ?? DASH],
    ["focus", () => read().editor.focus],
    [
      "pointer",
      () => {
        const at = read().pointer;
        return `${at.x.toFixed(0)}, ${at.y.toFixed(0)}${at.down ? " down" : ""}`;
      },
    ],
    ["course", () => String(challengeCount("campaign"))],
    ["simTime", () => read().simTime.toFixed(2)],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => orreryState(world))) {
    world.diagnostics.register(name, source);
  }
  world.diagnostics.register("fx", () => world.find(FxActor)?.fx.count ?? 0);
}
