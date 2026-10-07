// Deepcore — the two modes and what a death costs (specs/modes.md).
//
// In both modes a death ends the expedition at the Game Over screen, destroys a Core
// Sample held or ticking on the ground, and leaves every installed rocket component
// installed. The mode decides only what becomes of the save: Standard keeps it, so it
// can be restored; Hardcore deletes it.

import { clearSave } from "./save";
import { minerCenterX, minerCenterY } from "./physics";
import type { DeathCause } from "./types";
import type { Game } from "./game";

/** Seconds the death plays out before the mode's outcome is applied. */
export const DEATH_ANIM = 1.1;

/** Begin a death. A no-op while one is already playing out. */
export function triggerDeath(game: Game, cause: DeathCause): void {
  if (game.dying || game.launchAnim !== null) return;
  const x = minerCenterX(game.miner);
  const y = minerCenterY(game.miner);
  if (cause === "core-detonation")
    game.fxQueue.push({ kind: "core-detonation", x, y });
  game.fxQueue.push({ kind: "death-burst", x, y });
  game.sndQueue.push("death");

  game.satchel.coreSample = false;
  game.groundItems = game.groundItems.filter((g) => g.kind !== "core-sample");
  game.coreTimer = null;

  game.miner.drilling = null;
  game.deathCause = cause;
  game.dying = { cause, t: 0 };
  game.panel = null;

  // specs/modes.md: a death takes effect the moment its cause holds, and the
  // mode's consequence is applied then rather than when the Game Over screen
  // arrives — so nothing done after the death changes what it costs.
  applyModeCost(game);
}

/**
 * Apply what the mode charges for a death (specs/modes.md).
 *
 * Standard keeps the save; Hardcore deletes it. Idempotent, because it runs at
 * the death itself rather than at the screen the death leads to.
 */
function applyModeCost(game: Game): void {
  if (game.mode === "hardcore") clearSave();
}

/** Apply the mode's outcome once the death has played out. */
export function finalizeDeath(game: Game): void {
  const cause = game.dying?.cause ?? "hull-destroyed";
  game.dying = null;
  // The mode's cost was charged at the death itself; the screen only reports it.
  game.summary = game.makeSummary(cause);
  game.menuIndex = 0;
  game.screen = "game-over";
}
