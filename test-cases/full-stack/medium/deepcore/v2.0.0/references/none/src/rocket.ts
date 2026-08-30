// Deepcore — the escape rocket, the WIN condition (specs/rocket.md).
//
// Five components fabricated in order at the Launch Pad: two on Credits alone, two that
// also consume an exotic material (Resonite, Cryenite), and the Ignition Core that
// consumes the unstable Core Sample and STOPS its timer. Installed components are
// permanent and survive death. Installing all five enables LAUNCH → Victory.

import { ROCKET_COMPONENTS } from "./constants";
import type { RocketComponentDef } from "./constants";
import type { Material } from "./types";
import type { Game } from "./game";

/** The next uninstalled component (in order), or null once all five are installed. */
export function nextComponent(game: Game): RocketComponentDef | null {
  for (const c of ROCKET_COMPONENTS) {
    if (!game.installed.has(c.id)) return c;
  }
  return null;
}

/** Whether the miner currently holds the material a component needs. */
export function hasMaterial(game: Game, material: Material | null): boolean {
  if (material === null) return true;
  if (material === "resonite") return game.satchel.resonite > 0;
  if (material === "cryenite") return game.satchel.cryenite > 0;
  return game.satchel.coreSample; // core-sample
}

/** Whether the next component can be fabricated right now (Credits + material). */
export function canFabricate(game: Game): boolean {
  const c = nextComponent(game);
  if (!c) return false;
  return game.credits >= c.credits && hasMaterial(game, c.material);
}

/** Fabricate the next component: deduct Credits, consume material, install (specs/rocket.md). */
export function fabricate(game: Game): boolean {
  const c = nextComponent(game);
  if (!c || !canFabricate(game)) return false;
  game.credits -= c.credits;
  if (c.material === "resonite") game.satchel.resonite--;
  else if (c.material === "cryenite") game.satchel.cryenite--;
  else if (c.material === "core-sample") {
    game.satchel.coreSample = false;
    game.coreTimer = null; // installing the Ignition Core stops the countdown
  }
  game.installed.add(c.id);
  game.sndQueue.push("fabricate");
  return true;
}

/** All five components installed → the rocket is launch-ready (specs/rocket.md). */
export function allInstalled(game: Game): boolean {
  return game.installed.size === ROCKET_COMPONENTS.length;
}
