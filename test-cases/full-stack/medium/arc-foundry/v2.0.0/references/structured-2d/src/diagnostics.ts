// Arc Foundry — the values the engine's debug overlay shows (specs/instrumentation.md).
//
// The overlay itself is the engine's: it owns the panel, the backtick key that toggles
// it, drawing it outside the recorded frame, and keeping it read-only. Arc Foundry's
// whole part is to name the values it wants on it, which is what this file does.
//
// Every source is a PURE READ of the state it is handed — the state current at the
// moment the overlay reads it, which the engine passes in because a frame replaces the
// state rather than editing it, and a source that closed over the state built at
// start-up would report the title screen forever. Each line is short enough to read at a
// glance while the game runs.

import { difficulty, reportedPhase, stampsLeft, statsOf } from "./sim";
import type { FoundryView } from "./world";
import type { InitApi } from "@test-cabinet/simple-2d";

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<FoundryView>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (s) => {
    const phase = reportedPhase(s);
    return `${s.screen}${phase ? ` / ${phase}` : ""}${s.paused ? " (paused)" : ""}`;
  });
  api.diagnostics.register("wave", (s) => `${s.wave} / ${difficulty(s).waves}`);
  api.diagnostics.register("charge", (s) => s.charge);
  api.diagnostics.register("integrity", (s) => s.integrity);
  api.diagnostics.register("refinement", (s) => `R${s.refinement}`);
  api.diagnostics.register("stamps", (s) => stampsLeft(s));
  api.diagnostics.register("speed", (s) => `${s.speed}x`);
  api.diagnostics.register("maze", (s) => `${s.mazeLength.toFixed(1)} tiles`);
  api.diagnostics.register("units", (s) => s.units.length);
  api.diagnostics.register("structures", (s) => s.structures.length);
  api.diagnostics.register("selected", (s) => {
    if (s.selectedId === null) return "none";
    const sel = s.structures.find((x) => x.id === s.selectedId);
    if (!sel) return "none";
    if (sel.kind !== "component") return `#${sel.id} ${sel.kind}`;
    const st = statsOf(sel);
    return `#${sel.id}  dmg ${Math.round(st.dmg)}  rng ${Math.round(st.range)}`;
  });
}
