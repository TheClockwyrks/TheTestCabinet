// Refract — the case's fixed figures the suites read. CASE-PROVIDED.
//
// Every value here restates a figure the seeded specification fixes under the
// same name, so a check that fails on one names the spec's own constant.
//
// The build is seeded a `src/constants.ts` carrying these same figures, and
// this file exists so that no check reads them from there. A suite that asserts
// against the build's copy grades nothing: it asks whether the build does what
// the build says it does, which holds for every build, including one whose
// figure is wrong. The specification is the only authority a check compares
// against, so the validator states the figures itself.
//
// The board geometry, the tier ladder, and the board notation live in
// `notation.ts`, the spec-derived scenario library this project shares with the
// other engines'; this file carries what that library does not — the screen
// copy and the cue names — plus the one heading below for what the
// specification leaves to the build.

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
 * specs/modes/cascade.md: how far a readout's value may sit from its label and
 * still be beside it — at most this gap between the two runs horizontally, and
 * at most this far between their baselines (`HUD_VALUE_GAP`).
 */
export const HUD_VALUE_GAP = 96;

/**
 * specs/controls.md: the smallest a pointer target may be on each axis, which
 * is what a fingertip needs at the stage size.
 */
export const TARGET_MIN_W = 96;
export const TARGET_MIN_H = 72;

/* -------------------------------------------------------------------------- */
/* Audio cues (specs/ui.md "Audio")                                           */
/* -------------------------------------------------------------------------- */

/**
 * The five cue names, one per event, as `specs/ui.md` fixes them: the build
 * defines and plays exactly these on the engine's cue bus, so the name a cue is
 * played under is the specification's and not the build's.
 */
export const CUES = {
  connect: "connect",
  retract: "retract",
  channelComplete: "channel-complete",
  solved: "solved",
  clear: "clear",
} as const;

/* -------------------------------------------------------------------------- */
/* What the specification leaves to the build                                 */
/* -------------------------------------------------------------------------- */
//
// Read to drive the build, never compared against, and this file is the only
// one in the project that reads them.
//
// `specs/controls.md` names the actions Refract registers and fixes exactly one
// binding — `clear` is `KeyR` — saying of the rest that each action carries the
// keys a player reaches for by habit. It names no input layout at all, so which
// one the build registers with the engine is the build's own. The harness asks
// the build which layout to install and which key presses an action, and grades
// neither.

export { BINDINGS, LAYOUT } from "../src/constants";
