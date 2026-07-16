// Deepcore — the two modes and the death rule (specs/modes.md).
//
// There is one campaign and one balance; the mode changes ONLY what happens on death.
// In BOTH modes a death destroys the Core Sample (it never survives) and leaves every
// already-installed rocket component installed. There is no respawn and no dropped cache:
// a death always ends the current run at a summary (Game Over) screen. The mode decides
// what becomes of the single save slot (specs/flow.md, specs/save.md via save.ts):
//   • Standard — the save is KEPT; from the Game Over screen the player may CONTINUE FROM
//     SAVE, restoring their last surface save and picking the expedition back up.
//   • Hardcore — permadeath: the save is DELETED, so the expedition is gone for good and
//     the only option is a fresh start.
// The three deaths — out of fuel, hull destroyed, Core Sample detonation — all route here.

import { MINER_H, MINER_W } from "./physics";
import { clearSave } from "./save";
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

  // The Core Sample never survives a death (both modes) — destroy it, whether carried or
  // jettisoned as a ground item (specs/items.md).
  game.satchel.coreSample = false;
  game.groundItems = game.groundItems.filter((g) => g.kind !== "core-sample");
  game.coreTimer = null;

  m.drilling = null;
  game.deathCause = cause;
  game.dying = { cause, t: 0 };
  game.panel = null;
}

/** Apply the mode's death outcome once the death animation has played (specs/modes.md). */
export function finalizeDeath(game: Game): void {
  const cause = game.dying?.cause ?? "hull-destroyed";
  game.dying = null;

  // Hardcore is permadeath — consume the save so the expedition cannot be resumed. Standard
  // keeps the save, so the Game Over screen can offer CONTINUE FROM SAVE (specs/modes.md).
  if (game.mode === "hardcore") clearSave();

  game.summary = game.makeSummary(cause);
  game.phase = "game-over";
}
