// Wick — the values the engine's debug overlay shows
// (specs/instrumentation.md "Diagnostics").
//
// The overlay itself is the engine's: it owns the panel, the backtick key
// that toggles it, and its read-only-ness. Wick's whole part is to name the
// values it wants on it, registered through `world.diagnostics` from the game
// mode's `beginPlay`. Every source is a function of no arguments, invoked at
// each read, and every one is a pure read of the live state it reaches
// through the world the mode holds, so the panel reports the frame being
// drawn and watching it changes nothing. Each line is short enough to read
// at a glance while the game runs.

import type { World } from "@test-cabinet/structured-2d";
import { formatClock } from "./render/hud";
import { runTime, spawnWindow } from "./sim/enemies";
import { SWITCH_NAMES, wickState, type WickState } from "./state";
import { maxHp, xpToNext } from "./stats";

/**
 * The sources, each named and each a read through `read` at the call. Split
 * from the registration so the build's tests can drive the same sources over
 * a state of their own.
 */
export function diagnosticSources(
  read: () => WickState,
): [string, () => string | number | boolean][] {
  const run = (): WickState["run"] => read().run;
  const sources: [string, () => string | number | boolean][] = [
    ["screen", () => read().screen],
    ["clock", () => `${formatClock(runTime(run()))} (tick ${run().tick})`],
    [
      "level",
      () =>
        `${run().level}  xp ${run().xp.toFixed(1)} / ${xpToNext(run().level)}`,
    ],
    ["hp", () => `${run().player.hp.toFixed(1)} / ${maxHp(run().passives)}`],
    ["kills", () => run().kills],
    [
      "lamplighter",
      () =>
        `${run().player.x.toFixed(1)}, ${run().player.y.toFixed(1)} ${run().player.facing}`,
    ],
    ["enemies", () => `${run().enemies.length}  window ${spawnWindow(run())}`],
    [
      "effects",
      () =>
        `${run().projectiles.length} projectiles, ${run().zones.length} zones`,
    ],
    ["gems", () => run().gems.length],
    [
      "weapons",
      () =>
        run()
          .weapons.map((w) => `${w.id} L${w.level} ${w.cooldown.toFixed(2)}s`)
          .join(", ") || "none",
    ],
    [
      "passives",
      () =>
        run()
          .passives.map((p) => `${p.id} L${p.level}`)
          .join(", ") || "none",
    ],
    ["pending", () => run().pendingLevelUps],
  ];
  for (const name of SWITCH_NAMES) {
    sources.push([name, () => read()[name]]);
  }
  sources.push(["muted", () => read().muted]);
  return sources;
}

/** Register every source with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  for (const [name, source] of diagnosticSources(() => wickState(world))) {
    world.diagnostics.register(name, source);
  }
}
