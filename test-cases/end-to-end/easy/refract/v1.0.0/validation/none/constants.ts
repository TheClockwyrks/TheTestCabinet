// Refract — the case's fixed figures the suites read. CASE-PROVIDED.
//
// Every value here restates a figure the seeded specification fixes under the
// same name, so a check that fails on one names the spec's own constant. The
// geometry and the notation live in `notation.ts`, the spec-derived scenario
// library this project shares with the engine-backed ones; this file carries
// what that library does not: the screen copy, the key bindings the
// specification pins, and the keys this suite reaches the runtime layer with.

import { NODE_R } from "./notation";

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md, specs/modes/campaign.md, specs/modes/cascade.md)  */
/* -------------------------------------------------------------------------- */

/** The title screen's heading (`TITLE_TEXT`). */
export const TITLE_TEXT = "REFRACT";

/** The tagline under it (`TAGLINE_TEXT`). */
export const TAGLINE_TEXT = "DRAW THE LIGHT";

/** The title menu, in order (`TITLE_ITEMS`). */
export const TITLE_ITEMS = ["CAMPAIGN", "CASCADE", "HOW TO PLAY"] as const;

/** The select screen's row labels, top row down (`SET_LABELS`). */
export const SET_LABELS = ["SET A", "SET B", "SET C", "SET D"] as const;

/** The cascade solved screen's heading (`SOLVED_TITLE_TEXT`). */
export const SOLVED_TITLE_TEXT = "BOARD SOLVED";

/** The cascade solved screen's menu, in order (`SOLVED_ITEMS`). */
export const SOLVED_ITEMS = ["NEXT BOARD", "RESTART"] as const;

/** The cascade HUD labels (`HUD_SOLVED_LABEL`, `HUD_TIER_LABEL`). */
export const HUD_SOLVED_LABEL = "SOLVED";
export const HUD_TIER_LABEL = "TIER";

/**
 * specs/controls.md: the smallest a pointer target may be on each axis, which
 * is what a fingertip needs at the stage size.
 */
export const TARGET_MIN_W = 96;
export const TARGET_MIN_H = 72;

/** specs/ui.md: the two on-screen controls the pointer works the game through. */
export const BACK_LABEL = "BACK";
export const CLEAR_LABEL = "CLEAR";

/** What `reset` seeds `rngState` with when no seed is given (`DEFAULT_SEED`). */
export const DEFAULT_SEED = 1;

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The two bindings `specs/controls.md` and `specs/instrumentation.md` fix for
 * an engineless build: `clear` is bound to `KeyR`, and the debug overlay is
 * shown and hidden by the backtick key. Every other binding is the build's own.
 */
export const CLEAR_KEY = "KeyR";
export const OVERLAY_KEY = "Backquote";

/**
 * The key this suite fires each registered action with.
 *
 * `specs/controls.md` fixes only the `clear` binding and says of the rest that
 * "each action carries the keys a player reaches for by habit". For a
 * keyboard-only menu those habitual keys are the arrow cluster, Enter, and
 * Escape — the reading these validators drive the menus with — and the mute
 * toggle's habitual key is `M`. A build is conformant with these bound and more
 * besides; a build a player would have to discover an exotic binding for fails
 * the menu checks exactly as it fails that player.
 */
export const ACTION_KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "Enter",
  back: "Escape",
  clear: CLEAR_KEY,
  mute: "KeyM",
} as const;

/** An action a suite fires through the keyboard. */
export type ActionName = keyof typeof ACTION_KEYS;

/* -------------------------------------------------------------------------- */
/* Derived geometry                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The largest board's extent in logical units, widened by `NODE_R`: cell
 * centers span x `352..928` and y `152..632` (`specs/board.md`), and every
 * node's drawn form fits inside `NODE_R` of its center, so nothing of any
 * board is drawn outside this box and the readouts are required to sit clear
 * of it.
 */
export const BOARD_EXTENT = {
  x0: 352 - NODE_R,
  x1: 928 + NODE_R,
  y0: 152 - NODE_R,
  y1: 632 + NODE_R,
} as const;
