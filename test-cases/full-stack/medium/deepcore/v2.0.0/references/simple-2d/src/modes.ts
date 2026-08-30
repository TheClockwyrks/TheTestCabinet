// Deepcore — the two modes and what a death costs (specs/modes.md).
//
// In both modes a death ends the expedition at the Game Over screen, destroys a
// Core Sample held or ticking on the ground, and leaves every installed rocket
// component installed. The mode decides only what becomes of the save: Standard
// keeps it, so it can be restored; Hardcore deletes it.

import { CUES } from "./constants";
import type { DeathCause } from "./constants";
import { cue } from "./audio";
import { fx } from "./feedback";
import { minerCenterX, minerCenterY } from "./physics";
import { clearSave, hasSave } from "./save";
import type { Draft } from "./state";
import { DEATH_ANIM } from "./tuning";

export { DEATH_ANIM };

/** The summary the end screens show, taken from the expedition as it stands. */
export function makeSummary(d: Draft, deathCause: DeathCause | null): void {
  d.summary = {
    deepestDepthMeters: d.deepestDepthMeters,
    creditsEarned: d.creditsEarned,
    elapsedSeconds: d.elapsedSeconds,
    mode: d.mode,
    componentsInstalled: d.installed.length,
    deathCause,
  };
}

/** Begin a death. A no-op while one is already playing out. */
export function triggerDeath(d: Draft, cause: DeathCause): void {
  if (d.dying || d.launchAnim !== null) return;
  const x = minerCenterX(d.miner);
  const y = minerCenterY(d.miner);
  if (cause === "core-detonation") fx(d, "core-detonation", x, y);
  fx(d, "death-burst", x, y);
  cue(d, CUES.death);

  d.satchel.coreSample = false;
  d.groundItems = d.groundItems.filter((item) => item.kind !== "core-sample");
  d.coreTimer = null;

  d.miner.drilling = null;
  d.deathCause = cause;
  d.dying = { cause, t: 0 };
  d.panel = null;
}

/** Apply the mode's outcome once the death has played out. */
export function finalizeDeath(d: Draft): void {
  const cause = d.dying?.cause ?? "hull-destroyed";
  d.dying = null;
  if (d.mode === "hardcore") {
    clearSave();
    d.hasSave = hasSave();
  }
  makeSummary(d, cause);
  d.menuIndex = 0;
  d.screen = "game-over";
}
