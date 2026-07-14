// Deepcore — the two modes and the death rule (specs/modes.md).
//
// There is one campaign and one balance; the mode changes ONLY what happens on death.
// In BOTH modes a death destroys the Core Sample (it never survives) and leaves every
// already-installed rocket component installed. Standard drops the haul as a retrievable
// cache and respawns the miner at the surface; Hardcore ends the run at the Game Over
// screen. The three deaths — out of fuel, hull destroyed, Core Sample detonation — all
// route through here.

import { emptyCargo, cargoUsed } from "./economy";
import { MINER_H, MINER_W, minerCol, minerRow } from "./physics";
import type { DeathCause } from "./types";
import type { Game } from "./game";

/** Seconds the death animation/burst plays before the mode outcome is applied. */
export const DEATH_ANIM = 1.1;

/** Begin a death (specs/character.md, specs/hazards.md). Idempotent while dying. */
export function triggerDeath(game: Game, cause: DeathCause): void {
  if (game.dying || game.launchAnim !== null) return;
  const m = game.miner;
  const cx = m.x + MINER_W / 2;
  const cy = m.y + MINER_H / 2;
  if (cause === "core-detonation") {
    game.fxQueue.push({ kind: "core-detonation", x: cx, y: cy });
  }
  game.fxQueue.push({ kind: "death-burst", x: cx, y: cy });
  game.sndQueue.push("death");

  // The Core Sample never survives a death (both modes) — destroy it.
  game.satchel.coreSample = false;
  game.coreTimer = null;

  m.drilling = null;
  game.deathCause = cause;
  game.dying = { cause, t: 0 };
  game.panel = null;
}

/** Apply the mode's death outcome once the death animation has played. */
export function finalizeDeath(game: Game): void {
  const cause = game.dying?.cause ?? "hull-destroyed";
  game.dying = null;

  if (game.mode === "standard") {
    // Drop the carried haul (cargo + uninstalled Resonite/Cryenite, NOT the Core Sample)
    // as a single most-recent retrievable cache at the death site (specs/modes.md).
    const hasHaul = cargoUsed(game.cargo) > 0 || game.satchel.resonite > 0 || game.satchel.cryenite > 0;
    if (hasHaul) {
      game.cache = {
        col: minerCol(game.miner),
        row: Math.max(1, minerRow(game.miner)),
        cargo: { ...game.cargo },
        resonite: game.satchel.resonite,
        cryenite: game.satchel.cryenite,
      };
    }
    game.cargo = emptyCargo();
    game.satchel.resonite = 0;
    game.satchel.cryenite = 0;
    // Respawn at the surface with full fuel + repaired hull; keep Credits, tiers, rocket.
    game.placeMinerAtSurface();
    game.miner.fuel = game.maxFuel();
    game.miner.hull = game.maxHull();
    game.miner.state = "idle";
    game.note("HAUL DROPPED — RESPAWNED AT SURFACE");
  } else {
    // Hardcore: the run is over (specs/flow.md).
    game.summary = game.makeSummary(cause);
    game.phase = "game-over";
  }
}
