// Arc Foundry — the values the engine's debug overlay shows (specs/instrumentation.md).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that toggles
// it, drawing it outside the recorded frame, and keeping it read-only. Arc Foundry's
// whole part is to name the values it wants on it, which is what this file does, through
// the world's diagnostic registry from the game mode's `beginPlay`.
//
// Every source is a function of NO ARGUMENTS, called at each read, and every one is a
// PURE READ of the live state it reaches through the world the mode holds, so the panel
// reports the frame being drawn and watching the overlay leaves the game exactly as it
// is. Each line is short enough to read at a glance while the game runs.

import type { World } from "@test-cabinet/structured-2d";
import { foundryState, type FoundryState } from "./state";
import { difficulty, reportedPhase, stampsLeft, statsOf } from "./sim";

/**
 * The sources, each named and each a read through `read` at the call.
 *
 * Split from the registration so the build's own tests can drive the same sources over
 * a state of their own, with no engine and no overlay behind them.
 */
export function diagnosticSources(
  read: () => FoundryState,
): [string, () => unknown][] {
  return [
    [
      "screen",
      () => {
        const s = read();
        const phase = reportedPhase(s);
        return `${s.screen}${phase ? ` / ${phase}` : ""}${s.paused ? " (paused)" : ""}`;
      },
    ],
    [
      "wave",
      () => {
        const s = read();
        return `${s.wave} / ${difficulty(s).waves}`;
      },
    ],
    ["charge", () => read().charge],
    ["integrity", () => read().integrity],
    ["refinement", () => `R${read().refinement}`],
    ["stamps", () => stampsLeft(read())],
    ["speed", () => `${read().speed}x`],
    ["maze", () => `${read().mazeLength.toFixed(1)} tiles`],
    ["units", () => read().units.length],
    ["structures", () => read().structures.length],
    [
      "selected",
      () => {
        const s = read();
        if (s.selectedId === null) return "none";
        const sel = s.structures.find((x) => x.id === s.selectedId);
        if (!sel) return "none";
        if (sel.kind !== "component") return `#${sel.id} ${sel.kind}`;
        const st = statsOf(sel);
        return `#${sel.id}  dmg ${Math.round(st.dmg)}  rng ${Math.round(st.range)}`;
      },
    ],
  ];
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => foundryState(world))) {
    world.diagnostics.register(name, source);
  }
}
