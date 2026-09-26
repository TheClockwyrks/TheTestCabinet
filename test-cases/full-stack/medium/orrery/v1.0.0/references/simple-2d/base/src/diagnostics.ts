// Orrery — the values the engine's debug overlay shows
// (specs/instrumentation.md "Diagnostics").
//
// The overlay itself is the engine's: it owns the panel, the backtick key that
// toggles it, and its read-only-ness. Orrery's whole part is to NAME the values
// it wants on it, which is what this file does — the screen and mode, the open
// challenge's name and source, the part count and cost, the period, the run's
// status, cycle, fraction, and speed, each product's tally against the target,
// the mote count, the banked area, the fault kind, the focus, and the pointer
// position: the same facts the snapshot reports.
//
// Every source is a PURE READ of the state it is handed — the state current at
// the moment the overlay reads it, which the engine passes in because the
// state is a value every frame replaces. Nothing is closed over, so a source
// cannot report the title screen forever, and watching the overlay never
// changes what the simulation does. Each line is short enough to read at a
// glance while the game runs.

import type { InitApi } from "@clockwyrks/simple-2d";
import { challengeCount } from "./challenges";
import { liveEffectCount } from "./effects";
import { machinePeriod } from "./machine";
import { machineCost } from "./parts";
import type { OrreryState } from "./types";

/** What a field with nothing to report shows. */
const DASH = "—";

/** Register every diagnostic source, each a read of the state it is given. */
export function registerDiagnostics(
  api: Pick<InitApi<OrreryState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (state) => state.screen);
  api.diagnostics.register("mode", (state) => state.mode);
  api.diagnostics.register(
    "challenge",
    (state) => state.challenge?.name ?? DASH,
  );
  api.diagnostics.register("source", (state) => {
    if (state.challenge === null) return DASH;
    const ref = state.challengeRef;
    return ref === null ? "custom" : `${ref.mode} ${ref.index + 1}`;
  });
  api.diagnostics.register("parts", (state) => state.editor.parts.length);
  api.diagnostics.register("cost", (state) => machineCost(state.editor.parts));
  api.diagnostics.register("period", (state) =>
    machinePeriod(state.editor.parts),
  );
  api.diagnostics.register("status", (state) => state.sim?.status ?? DASH);
  api.diagnostics.register("cycle", (state) =>
    state.sim === null ? DASH : state.sim.cycle,
  );
  api.diagnostics.register("fraction", (state) =>
    state.sim === null ? DASH : state.sim.fraction.toFixed(3),
  );
  api.diagnostics.register("speed", (state) =>
    state.sim === null ? DASH : state.sim.speed,
  );
  api.diagnostics.register("tallies", (state) => {
    const { sim, challenge } = state;
    if (sim === null || challenge === null) return DASH;
    return sim.tallies.map((tally) => `${tally}/${challenge.target}`).join(" ");
  });
  api.diagnostics.register("motes", (state) => state.sim?.motes.length ?? 0);
  api.diagnostics.register("area", (state) => state.sim?.areaHexes.length ?? 0);
  api.diagnostics.register("fault", (state) => state.sim?.fault?.kind ?? DASH);
  api.diagnostics.register("focus", (state) => state.editor.focus);
  api.diagnostics.register("pointer", (state) => {
    const at = state.pointer;
    return `${at.x.toFixed(0)}, ${at.y.toFixed(0)}${at.down ? " down" : ""}`;
  });
  api.diagnostics.register("course", () => challengeCount("campaign"));
  api.diagnostics.register("effects", () => liveEffectCount());
  api.diagnostics.register("simTime", (state) => state.simTime.toFixed(2));
}
