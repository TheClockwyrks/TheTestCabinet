// Shatter — the values the engine's debug overlay reports.
//
// The overlay is read-only and the engine's: it draws the panel and owns the key
// that toggles it. Shatter's part is registering the sources
// `specs/instrumentation.md` lists, which is done once, in the game mode's
// `beginPlay`, against the WORLD's registry — every one of them reads the world
// the mode holds, which is rebuilt when a level opens.
//
// Each source is a pure read of the live state at the call, so watching the
// overlay leaves the game exactly as it is, and each is kept short enough to sit
// on one line.

import type { World } from "@test-cabinet/structured-2d";
import { shatterState } from "./game";

/** A number rounded for display, so a line stays readable. */
function figure(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Register Shatter's diagnostic sources with the world's overlay registry. */
export function registerDiagnostics(world: World): void {
  const read = () => shatterState(world);

  world.diagnostics.register("screen", () => read().screen);
  world.diagnostics.register("score", () => read().score);
  world.diagnostics.register("lives", () => read().lives);
  world.diagnostics.register("wave", () => read().wave);

  world.diagnostics.register("ship", () => {
    const { ship } = read();
    return { x: figure(ship.x), y: figure(ship.y) };
  });
  world.diagnostics.register("ship-velocity", () => {
    const { ship } = read();
    return { vx: figure(ship.vx), vy: figure(ship.vy) };
  });
  world.diagnostics.register("ship-speed", () => {
    const { ship } = read();
    return figure(Math.hypot(ship.vx, ship.vy));
  });
  world.diagnostics.register("ship-facing", () => figure(read().ship.angle));
  world.diagnostics.register("ship-invuln", () => figure(read().ship.invuln));

  world.diagnostics.register("bullets", () => read().bullets.length);
  world.diagnostics.register("rocks", () => read().rocks.length);

  world.diagnostics.register("saucer", () => {
    const { saucer } = read();
    return saucer === null
      ? "none"
      : { x: figure(saucer.x), y: figure(saucer.y) };
  });

  world.diagnostics.register("torpedo-charge", () =>
    figure(read().torpedoCharge),
  );
  world.diagnostics.register("torpedoes", () => read().torpedoes.length);

  world.diagnostics.register("sim-time", () => figure(read().simTime));
}
