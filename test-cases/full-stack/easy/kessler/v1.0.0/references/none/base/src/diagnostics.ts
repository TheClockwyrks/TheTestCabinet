// Kessler — the values the debug overlay reports (specs/instrumentation.md).
//
// A registry of named sources, each a pure read of the game, so watching the
// overlay leaves the game exactly as it is. The overlay draws whatever is
// registered here; adding a line to the panel is registering one more source.

import type { Game } from "./game";
import { spanOf } from "./state";

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

/**
 * Registers the sources the overlay shows — at least the current screen, the
 * score, the lives, the wave, the deflector's angle and span, the live ball,
 * target, and pod counts, the three effect timers, and the shield state, the
 * same facts the snapshot reports (`specs/instrumentation.md` Diagnostics).
 * Each is a pure read of the game, kept short enough to read on a line.
 */
export function registerGameDiagnostics(
  diagnostics: Diagnostics,
  game: Game,
  fx: { readonly count: number },
): void {
  const session = (): Game["session"] => game.session;
  diagnostics.register("screen", () => game.screen);
  diagnostics.register("score", () => String(session().score));
  diagnostics.register("lives", () => String(session().lives));
  diagnostics.register("wave", () => String(session().wave));
  diagnostics.register(
    "paddle",
    () =>
      `${session().paddleAngleDeg.toFixed(1)} deg / ${spanOf(session())} deg`,
  );
  diagnostics.register("balls", () => String(session().balls.length));
  diagnostics.register("targets", () =>
    String(
      session().rings.reduce(
        (count, ring) =>
          count + ring.targets.filter((hp) => hp !== null).length,
        0,
      ),
    ),
  );
  diagnostics.register("pods", () => String(session().pods.length));
  diagnostics.register("widen", () => `${session().effects.widenTicks} ticks`);
  diagnostics.register(
    "narrow",
    () => `${session().effects.narrowTicks} ticks`,
  );
  diagnostics.register(
    "pierce",
    () => `${session().effects.pierceTicks} ticks`,
  );
  diagnostics.register("shield", () =>
    session().effects.shieldActive ? "active" : "down",
  );
  diagnostics.register("autoStep", () => String(game.autoStep));
  diagnostics.register("ticks", () => String(game.ticks));
  diagnostics.register("fx", () => String(fx.count));
}
