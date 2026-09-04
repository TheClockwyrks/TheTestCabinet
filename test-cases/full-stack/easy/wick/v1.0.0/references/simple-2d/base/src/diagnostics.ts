// Wick — the values the engine's debug overlay shows
// (specs/instrumentation.md "Diagnostics").
//
// The overlay itself is the engine's: it owns the panel, the backtick key
// that toggles it, and its read-only-ness. Wick's part is to name the values
// it wants on it. Every source is a pure read of the state it is handed, the
// state current at the read, so watching the overlay changes nothing.

import type { InitApi } from "@test-cabinet/simple-2d";
import type { WickState } from "./game";
import { runTime, spawnWindow } from "./sim/enemies";
import { SWITCH_NAMES } from "./state";
import { maxHp, xpToNext } from "./stats";

/** The run clock as `m:ss`. */
export function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

/**
 * Register the sources the overlay shows: the screen, the run clock, the
 * level and experience, health, kills, the lamplighter, the counts, the
 * loadout, the queued level-ups, the seven driver switches, and the mute
 * bit the game mirrors.
 */
export function registerDiagnostics(
  api: Pick<InitApi<WickState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (s) => s.screen);
  api.diagnostics.register(
    "clock",
    (s) => `${formatClock(runTime(s.run))} (tick ${s.run.tick})`,
  );
  api.diagnostics.register(
    "level",
    (s) =>
      `${s.run.level}  xp ${s.run.xp.toFixed(1)} / ${xpToNext(s.run.level)}`,
  );
  api.diagnostics.register(
    "hp",
    (s) => `${s.run.player.hp.toFixed(1)} / ${maxHp(s.run.passives)}`,
  );
  api.diagnostics.register("kills", (s) => s.run.kills);
  api.diagnostics.register(
    "lamplighter",
    (s) =>
      `${s.run.player.x.toFixed(1)}, ${s.run.player.y.toFixed(1)} ${s.run.player.facing}`,
  );
  api.diagnostics.register(
    "enemies",
    (s) => `${s.run.enemies.length}  window ${spawnWindow(s.run)}`,
  );
  api.diagnostics.register(
    "effects",
    (s) =>
      `${s.run.projectiles.length} projectiles, ${s.run.zones.length} zones`,
  );
  api.diagnostics.register("gems", (s) => s.run.gems.length);
  api.diagnostics.register("weapons", (s) =>
    s.run.weapons.length === 0
      ? "none"
      : s.run.weapons
          .map((w) => `${w.id} L${w.level} ${w.cooldown.toFixed(2)}s`)
          .join(", "),
  );
  api.diagnostics.register("passives", (s) =>
    s.run.passives.length === 0
      ? "none"
      : s.run.passives.map((p) => `${p.id} L${p.level}`).join(", "),
  );
  api.diagnostics.register("pending", (s) => s.run.pendingLevelUps);
  for (const name of SWITCH_NAMES) {
    api.diagnostics.register(name, (s) => s[name]);
  }
  api.diagnostics.register("muted", (s) => s.muted);
}
