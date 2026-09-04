// Spectra — the seven screens, their menus, and where each one leads.
//
// `specs/ui.md` fixes what every screen shows and what each menu item does, and
// `specs/controls.md` fixes that every menu is vertical, driven by `up`, `down` and
// `confirm`, and WRAPS at both ends. This file is those rules; what a screen LOOKS
// like is `src/render.ts`.
//
// The holds are here too, because a hold is a screen's own timer rather than
// anything about the field: the stage intro gives way to the live wave, the
// stage-cleared interstitial to the next stage's intro. Each counts down inside the
// game's sub-step loop like every other duration, so `advance(1, 1)` and
// `advance(1, 60)` reach the same screen.

import {
  CUES,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { LANE_CENTER } from "./field";
import { endReadyHold } from "./progression";
import { openLiveWave, openNextStage, openStageIntro } from "./stages";
import type { CueSink } from "./audio";
import type { Intents } from "./input";
import type { Screen, SpectraState } from "./types";

/** The items the menu on `screen` lists, or none where the screen has no menu. */
export function menuItemsFor(screen: Screen): readonly string[] {
  if (screen === "title") return TITLE_ITEMS;
  if (screen === "paused") return PAUSE_ITEMS;
  if (screen === "gameOver") return GAME_OVER_ITEMS;
  return [];
}

/** Move a menu highlight by `step`, wrapping at both ends. */
export function moveHighlight(
  state: SpectraState,
  step: number,
  cues: CueSink,
): void {
  const items = menuItemsFor(state.screen);
  if (items.length === 0) return;
  state.menuIndex = (state.menuIndex + step + items.length) % items.length;
  cues.raise(CUES.menu);
}

/**
 * Open a fresh run at stage 1.
 *
 * What the title's mode entry, the pause menu's RESTART and the game-over screen's
 * PLAY AGAIN all do: the score returns to `0`, the lives to `START_LIVES`, the stage
 * to `1`, and the wave's own entry and dive launching are on, as they are whenever a
 * run begins.
 */
export function startRun(state: SpectraState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.extraLifeAwarded = false;
  state.challengeHits = 0;
  state.resonance = 0;
  state.inversion = 0;
  state.ship.x = LANE_CENTER;
  state.ship.band = "cyan";
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
  state.ship.contact = true;
  state.discharge.active = false;
  state.discharge.elapsed = 0;
  state.discharge.radius = 0;
  state.drones = [];
  state.bullets = [];
  state.bursts = [];
  state.waveEntry = true;
  state.diveLaunching = true;
  openStageIntro(state);
}

/** Return to the title, with its highlight at the first item. */
export function backToTitle(state: SpectraState): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
}

/** Take the highlighted item of whichever menu the current screen shows. */
function confirmItem(state: SpectraState, cues: CueSink): void {
  if (state.screen === "title") {
    if (state.menuIndex === 0) startRun(state);
    else {
      state.screen = "howto";
      state.menuIndex = 0;
    }
    return;
  }
  if (state.screen === "paused") {
    if (state.menuIndex === 0) resume(state);
    else if (state.menuIndex === 1) startRun(state);
    else backToTitle(state);
    return;
  }
  if (state.screen === "gameOver") {
    if (state.menuIndex === 0) startRun(state);
    else backToTitle(state);
    return;
  }
  void cues;
}

/** Pause the live wave, leaving the field exactly where it stands. */
export function pause(state: SpectraState): void {
  state.screen = "paused";
  state.menuIndex = 0;
}

/** Return to the live wave with the field and the run exactly as they were. */
export function resume(state: SpectraState): void {
  state.screen = "inWave";
  state.menuIndex = 0;
}

/**
 * Advance whichever screen is not the live wave, by `h` seconds.
 *
 * The paused screen deliberately advances NOTHING: no phase timer runs, none of the
 * clocks the wave keeps advances, and no cue plays, so a paused game is exactly
 * where it was when it was paused.
 */
export function updateScreen(
  state: SpectraState,
  intents: Intents,
  cues: CueSink,
  h: number,
): void {
  switch (state.screen) {
    case "title":
    case "gameOver":
      if (intents.up) moveHighlight(state, -1, cues);
      if (intents.down) moveHighlight(state, 1, cues);
      if (intents.confirm) confirmItem(state, cues);
      return;
    case "howto":
      if (intents.back) backToTitle(state);
      return;
    case "paused":
      if (intents.up) moveHighlight(state, -1, cues);
      if (intents.down) moveHighlight(state, 1, cues);
      if (intents.confirm) confirmItem(state, cues);
      // `pause` and `back` both return to the live wave. The edge is cleared here
      // rather than at the end of the sub-step, because the live wave is advanced
      // in this same sub-step and would otherwise read the very press that
      // resumed it as a fresh press to pause on.
      if (intents.pause || intents.back) {
        resume(state);
        intents.pause = false;
        intents.back = false;
      }
      return;
    case "stageIntro":
      state.phaseTimer -= h;
      if (state.phaseTimer <= 0) openLiveWave(state);
      return;
    case "stageCleared":
      state.phaseTimer -= h;
      if (state.phaseTimer <= 0) openNextStage(state);
      return;
    case "inWave":
      // The live wave is `src/game.ts`'s, because it is the whole simulation; the
      // one screen-level timer it carries is the ready hold.
      if (state.phase === "ready") {
        state.phaseTimer -= h;
        if (state.phaseTimer <= 0) endReadyHold(state);
      }
      return;
  }
}
