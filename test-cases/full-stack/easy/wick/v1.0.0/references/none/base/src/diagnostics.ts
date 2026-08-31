// Wick — the values the debug overlay reports (specs/instrumentation.md
// "Diagnostics").
//
// A registry of named sources, each a pure read of the game, so watching the
// overlay leaves the game exactly as it is. The overlay draws whatever is
// registered here.

import type { Cue } from "./constants";
import { SWITCH_NAMES } from "./state";
import type { Game } from "./game";
import { runTime, spawnWindow } from "./sim/enemies";
import { maxHp, xpToNext } from "./stats";

export interface DiagnosticSource {
  label: string;
  read(): string;
}

export class Diagnostics {
  private readonly sources: DiagnosticSource[] = [];

  /** Register one source. `read` runs at each draw and changes nothing. */
  register(label: string, read: () => string): void {
    this.sources.push({ label, read });
  }

  /** Every registered source, read now, in registration order. */
  lines(): { label: string; value: string }[] {
    return this.sources.map((source) => ({
      label: source.label,
      value: source.read(),
    }));
  }
}

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
 * loadout, the queued level-ups, and the seven driver switches.
 */
export function registerGameDiagnostics(
  diagnostics: Diagnostics,
  game: Game,
): void {
  const run = (): Game["state"]["run"] => game.state.run;
  diagnostics.register("screen", () => game.state.screen);
  diagnostics.register(
    "clock",
    () => `${formatClock(runTime(run()))} (tick ${run().tick})`,
  );
  diagnostics.register(
    "level",
    () =>
      `${run().level}  xp ${run().xp.toFixed(1)} / ${xpToNext(run().level)}`,
  );
  diagnostics.register(
    "hp",
    () => `${run().player.hp.toFixed(1)} / ${maxHp(run().passives)}`,
  );
  diagnostics.register("kills", () => String(run().kills));
  diagnostics.register(
    "lamplighter",
    () =>
      `${run().player.x.toFixed(1)}, ${run().player.y.toFixed(1)} ${run().player.facing}`,
  );
  diagnostics.register(
    "enemies",
    () => `${run().enemies.length}  window ${spawnWindow(run())}`,
  );
  diagnostics.register(
    "effects",
    () =>
      `${run().projectiles.length} projectiles, ${run().zones.length} zones`,
  );
  diagnostics.register("gems", () => String(run().gems.length));
  diagnostics.register("weapons", () =>
    run()
      .weapons.map((w) => `${w.id} L${w.level} ${w.cooldown.toFixed(2)}s`)
      .join(", "),
  );
  diagnostics.register("passives", () =>
    run()
      .passives.map((p) => `${p.id} L${p.level}`)
      .join(", "),
  );
  diagnostics.register("pending", () => String(run().pendingLevelUps));
  for (const name of SWITCH_NAMES) {
    diagnostics.register(name, () =>
      game.state.switches[name] ? "on" : "off",
    );
  }
  diagnostics.register("autoStep", () => String(game.autoStep));
}

/** As much of the audio layer as the overlay reports. */
export interface AudioDiagnosed {
  /** The looping cues sounding right now. */
  looping(): Cue[];
  /** The runtime's mute bit. */
  readonly muted: boolean;
}

/**
 * Register the audio sources: the looping cues sounding, and the mute bit the
 * game mirrors into `muted`.
 */
export function registerAudioDiagnostics(
  diagnostics: Diagnostics,
  audio: AudioDiagnosed,
): void {
  diagnostics.register("loops", () => {
    const looping = audio.looping();
    return looping.length === 0 ? "none" : looping.join(", ");
  });
  diagnostics.register("muted", () => (audio.muted ? "yes" : "no"));
}
