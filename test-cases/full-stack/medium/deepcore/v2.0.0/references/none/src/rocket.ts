// Deepcore — the escape rocket, and the only way to win (specs/rocket.md).
//
// Five components fabricated in order at the Launch Pad: two on Credits alone, two
// that also consume an exotic material, and the Ignition Core that consumes the Core
// Sample and stops its timer. Installed components are permanent and survive a death.

import { ROCKET_COMPONENTS } from "./constants";
import type { RocketComponentDef } from "./constants";
import type { Material } from "./types";
import type { Game } from "./game";

/** The next uninstalled component, or null once all five are in. */
export function nextComponent(game: Game): RocketComponentDef | null {
  for (const c of ROCKET_COMPONENTS) {
    if (!game.installed.has(c.id)) return c;
  }
  return null;
}

/** Whether the satchel holds the material a component needs. */
export function hasMaterial(game: Game, material: Material | null): boolean {
  if (material === null) return true;
  if (material === "resonite") return game.satchel.resonite > 0;
  if (material === "cryenite") return game.satchel.cryenite > 0;
  return game.satchel.coreSample;
}

/** Whether the next component can be fabricated as things stand. */
export function canFabricate(game: Game): boolean {
  const c = nextComponent(game);
  if (!c) return false;
  return game.credits >= c.credits && hasMaterial(game, c.material);
}

/** Fabricate the next component: deduct the Credits, consume the material, install it. */
export function fabricate(game: Game): boolean {
  const c = nextComponent(game);
  if (!c) {
    game.note("THE ROCKET IS COMPLETE");
    return false;
  }
  if (game.credits < c.credits) {
    game.note("NOT ENOUGH CREDITS");
    return false;
  }
  if (!hasMaterial(game, c.material)) {
    game.note("MATERIAL MISSING");
    return false;
  }
  game.credits -= c.credits;
  if (c.material === "resonite") game.satchel.resonite--;
  else if (c.material === "cryenite") game.satchel.cryenite--;
  else if (c.material === "core-sample") {
    game.satchel.coreSample = false;
    game.coreTimer = null; // installing the Ignition Core stops the countdown
  }
  game.installed.add(c.id);
  game.sndQueue.push("fabricate");
  game.note(`${c.label.toUpperCase()} INSTALLED`);
  return true;
}

/** Whether all five components are installed. */
export function allInstalled(game: Game): boolean {
  return game.installed.size === ROCKET_COMPONENTS.length;
}
