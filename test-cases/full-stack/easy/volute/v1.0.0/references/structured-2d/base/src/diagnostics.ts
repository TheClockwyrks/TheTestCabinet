// Volute — the values the debug overlay shows (specs/instrumentation.md,
// "Diagnostics").
//
// The overlay is the engine's: it draws the panel, toggles it on the backtick
// key, and keeps it read-only. Volute's part is naming the values, through the
// two registries the engine documents — a value that outlives a level on the
// INSTANCE's registry, and a value read off the open world on the WORLD's.
//
// Every source below is a pure read of the live game, short enough to sit on one
// line, so watching the panel leaves the game exactly as it found it.

import type { InitApi } from "@test-cabinet/structured-2d";
import { HallMode, inDanger } from "./hall-mode";
import type { VoluteGame } from "./game";

/** Round a reading to two places, so a live figure does not jitter the panel. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The two values that outlive a level transition, read off the instance. */
export function registerInstanceDiagnostics(
  api: InitApi,
  game: VoluteGame,
): void {
  api.diagnostics.register("seed", () => game.rngState >>> 0);
  api.diagnostics.register("sim", () => round(game.simTime()));
}

/** Everything read off the open world, registered as that world begins play. */
export function registerWorldDiagnostics(mode: HallMode): void {
  const world = mode.world;
  const state = mode.state;
  const register = world.diagnostics.register.bind(world.diagnostics);

  register("screen", () => state.screen);
  register("run", () => `level ${state.level}  score ${state.score}`);
  register("cells", () => state.cells);
  register("quota", () => state.quotaRemaining);
  register(
    "pressure",
    () => `${round(state.pressure)}  feed ${round(mode.feedSpeed())}`,
  );
  register("chain", () => `${state.chainStep} x  ${round(state.chainTimer)}s`);
  register("train", () => {
    const head = state.cores[0];
    return `${state.cores.length} cores  head ${head === undefined ? "-" : round(head.s)}`;
  });
  register("segments", () => state.segments.length);
  register("danger", () => inDanger(state));
  register("injector", () => {
    const injector = mode.injector();
    return `${injector.loaded ?? "-"} / ${injector.queued ?? "-"}  aim ${round(
      injector.aim,
    )}  cd ${round(injector.cooldown)}`;
  });
  register("shots", () => state.projectiles.length);
  register("machinery", () => {
    const machinery = state.machinery;
    return machinery === null
      ? "none"
      : `${machinery.kind}  ${round(machinery.remaining)}s`;
  });
}
