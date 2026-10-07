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

import { CUES, START_LIVES, TITLE_ITEMS } from "./constants";
import { LANE_CENTER } from "./field";
import { highlightedItem, itemAt, menuOf, type Menu } from "./menus";
import type { PointerPoint } from "./pointer";
import { endReadyHold } from "./progression";
import { openLiveWave, openNextStage, openStageIntro } from "./stages";
import type { CueSink } from "./audio";
import type { Intents } from "./input";
import type { UpdateApi } from "./runtime";
import type { Screen, SpectraState } from "./types";

/** The items the menu on `screen` lists, or none where the screen has no menu. */
export function menuItemsFor(screen: Screen): readonly string[] {
  return menuOf(screen)?.items ?? [];
}

/** `HOW TO PLAY`'s index on the title menu (`specs/ui.md`, `TITLE_ITEMS`). */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Move a menu highlight by `step`, wrapping at both ends. */
export function moveHighlight(
  state: SpectraState,
  step: number,
  cues: CueSink,
): void {
  const menu = menuOf(state.screen);
  if (menu === null) return;
  const count = menu.items.length;
  const current = highlightedItem(menu, state.menuIndex);
  state.menuIndex = (current + step + count) % count;
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
  state.stageClearing = true;
  openStageIntro(state);
}

/**
 * Return to the title, with its highlight on the entry that led away from it.
 *
 * `specs/ui.md`: an arrival back at the title puts the highlight on the title
 * entry that led away, which is the mode entry after a run and `HOW TO PLAY`
 * after the how-to-play screen.
 */
export function backToTitle(state: SpectraState, index = 0): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = index;
}

/**
 * Take item `index` of whichever menu the current screen shows.
 *
 * `specs/ui.md` gives the keyboard, the pointer and a finger the same effect, so
 * every confirm lands here rather than each input carrying its own copy of what an
 * entry does.
 */
function confirmItem(state: SpectraState, index: number, cues: CueSink): void {
  if (state.screen === "title") {
    if (index === 0) startRun(state);
    else {
      state.screen = "howto";
      state.menuIndex = 0;
    }
    return;
  }
  if (state.screen === "paused") {
    if (index === 0) resume(state);
    else if (index === 1) startRun(state);
    else backToTitle(state);
    return;
  }
  if (state.screen === "gameOver") {
    if (index === 0) startRun(state);
    else backToTitle(state);
    return;
  }
  void cues;
}

/** Take whichever item the menu is DRAWING as highlighted. */
function confirmHighlighted(state: SpectraState, cues: CueSink): void {
  const menu = menuOf(state.screen);
  if (menu === null) return;
  confirmItem(state, highlightedItem(menu, state.menuIndex), cues);
}

/**
 * Apply this frame's pointer and touch input to the menu on screen.
 *
 * Read once per frame and applied AFTER the frame's keyboard edges
 * (`specs/ui.md`), so a frame carrying both a keyboard movement edge and a pointer
 * selection ends on the item the pointer named.
 *
 * A move onto an item selects it, and so does a press landing on one — which is
 * what makes a finger, which never hovers, select the item it lands on. A confirm
 * takes BOTH its edges inside one item's region: a press and a release in different
 * regions, or either of them outside every region, confirms nothing.
 */
function menuPointer(
  state: SpectraState,
  api: UpdateApi,
  menu: Menu,
  cues: CueSink,
): void {
  const frame = api.pointer.frame();

  const select = (at: PointerPoint): void => {
    const index = itemAt(menu, at.x, at.y);
    if (index !== null && index !== state.menuIndex) {
      state.menuIndex = index;
      cues.raise(CUES.menu);
    }
  };
  if (frame.moved !== null) select(frame.moved);
  if (frame.pressed !== null) select(frame.pressed);

  const released = frame.released;
  if (released === null) return;
  const from = itemAt(menu, released.from.x, released.from.y);
  const to = itemAt(menu, released.to.x, released.to.y);
  if (from === null || from !== to) return;
  state.menuIndex = to;
  confirmItem(state, to, cues);
}

/**
 * Apply the frame's pointer to whatever menu the screen the frame ENDED on shows.
 *
 * A frame whose keys left the screen has already had its confirm, and the menu the
 * pointer was over is gone; the press in progress goes with it, so a gesture cannot
 * span two screens.
 */
export function applyPointer(
  state: SpectraState,
  api: UpdateApi,
  opened: Screen,
  cues: CueSink,
): void {
  if (state.screen !== opened) {
    api.pointer.forget();
    return;
  }
  const menu = menuOf(state.screen);
  if (menu !== null) menuPointer(state, api, menu, cues);
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
      if (intents.confirm) confirmHighlighted(state, cues);
      return;
    case "howto":
      if (intents.back) backToTitle(state, HOW_TO_PLAY_INDEX);
      return;
    case "paused":
      if (intents.up) moveHighlight(state, -1, cues);
      if (intents.down) moveHighlight(state, 1, cues);
      if (intents.confirm) confirmHighlighted(state, cues);
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
