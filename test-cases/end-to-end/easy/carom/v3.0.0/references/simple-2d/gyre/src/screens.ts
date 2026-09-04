// Carom — the screen transitions every menu, every input, and the debug surface
// are built from (specs/ui.md).
//
// Each of them is reached from more than one place. The title is where
// `QUIT TO MENU`, `MENU`, `back` on the match-over screen, and leaving the how-to
// screen all land; a match is what `SOLO`, `VERSUS`, `RESTART` and `PLAY AGAIN`
// all open; the debug surface's `reset` lands on a title of its own, which
// differs from the menus' in exactly the five fields specs/ui.md says a menu path
// keeps. Each rule lives here once, so the menus and the surface cannot drift.
//
// Every function is a transition: the current state in, the next state out.

import { DEFAULT_SEED, FIELD_CY } from "./constants";
import { parkedBall } from "./entities";
import type { CaromState, Mode, PaddleState } from "./game";
import { menuItemCount } from "./menus";
import { poseObstacles, reposeObstacles } from "./obstacles";
import type { DeepReadonly } from "ts-essentials";

/** The current state as every transition below reads it. */
type State = DeepReadonly<CaromState>;

/**
 * The state with the obstacle clock at `t` and every obstacle PRESENT re-posed to
 * match.
 *
 * The clock is the sole input to both poses, so the two are always set together —
 * on every frame, and on the frame `setObstacleClock` poses it. Which obstacles
 * are present is untouched: a cleared field stays cleared (specs/state.md).
 */
export function withObstacleClock(state: State, t: number): CaromState {
  return {
    ...state,
    obstacleClock: t,
    obstacles: reposeObstacles(state.obstacles, t),
  };
}

/** A paddle centered and stationary, keeping whose paddle it is. */
function centered(paddle: DeepReadonly<PaddleState>): PaddleState {
  return { ...paddle, cy: FIELD_CY, vy: 0 };
}

/**
 * Every declared field at its title-screen value except the five a path back to
 * the title keeps: `titleIndex`, `simTime`, `muted`, `seed` and `rngState`.
 *
 * `menuIndex` is deliberately absent — the two callers disagree about it, which is
 * the whole difference between quitting to the menu and resetting.
 */
function titleFields(): Omit<
  CaromState,
  "menuIndex" | "titleIndex" | "simTime" | "muted" | "seed" | "rngState"
> {
  return {
    screen: "title",
    mode: "solo",
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: {
      left: { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 },
      right: { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 },
    },
    ai: { tracking: true, movement: true },
    receiver: "left",
    ball: parkedBall(),
    obstacles: poseObstacles(0),
    obstacleClock: 0,
    obstacleClockRunning: true,
    pointerPresses: [],
  };
}

/**
 * The title screen as a MENU path reaches it (specs/ui.md).
 *
 * `titleIndex`, `simTime`, `muted`, `seed` and `rngState` keep their values —
 * time, the mute bit and the generator are not properties of a screen — and
 * `menuIndex` becomes `titleIndex`, so the entry that led away from the title is
 * the entry highlighted on the way back.
 */
export function toTitle(state: State): CaromState {
  return { ...state, ...titleFields(), menuIndex: state.titleIndex };
}

/**
 * The title screen as `reset` reaches it (specs/instrumentation.md).
 *
 * Every declared field at its title value, including the five a menu path keeps:
 * the remembered selection is forgotten, the clock is back at zero, and the
 * generator is reseeded from DEFAULT_SEED. `muted` alone is left as it is —
 * muting is a player preference the runtime owns, and a reset is not a reason to
 * start making noise again.
 */
export function resetToTitle(state: State): CaromState {
  return {
    ...state,
    ...titleFields(),
    menuIndex: 0,
    titleIndex: 0,
    simTime: 0,
    seed: DEFAULT_SEED,
    rngState: DEFAULT_SEED,
  };
}

/**
 * A match in `mode`, just opened (specs/ui.md's "Starting a match").
 *
 * It opens on the pre-serve countdown with the first serve aimed at player one,
 * the obstacle clock back at zero and running, and `titleIndex`, `simTime`, the
 * generator and both paddles' driven flags carried on: a match start says nothing
 * about who is holding a paddle, and the debug surface is the only thing that
 * does.
 */
export function startMatch(state: State, mode: Mode): CaromState {
  return {
    ...state,
    mode,
    screen: "countdown",
    resumeScreen: "playing",
    menuIndex: 0,
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    ball: parkedBall(),
    paddles: {
      left: centered(state.paddles.left),
      right: centered(state.paddles.right),
    },
    // The clock starts over rather than carrying the previous match's phase into
    // this one, and the obstacles standing on the field take the upright pose.
    obstacleClock: 0,
    obstacleClockRunning: true,
    obstacles: reposeObstacles(state.obstacles, 0),
    pointerPresses: [],
  };
}

/** The pause menu, over the screen it will resume to. */
export function pauseMatch(state: State): CaromState {
  return {
    ...state,
    resumeScreen: state.screen === "countdown" ? "countdown" : "playing",
    screen: "paused",
    menuIndex: 0,
  };
}

/** Back to the match, on whichever of the two screens the pause interrupted. */
export function resumeMatch(state: State): CaromState {
  return { ...state, screen: state.resumeScreen };
}

/**
 * The effect of confirming item `index` on the menu the current screen shows.
 *
 * ONE rule, whichever input raised the confirm: the keyboard's `confirm` action,
 * a mouse pressed and released inside the item, and a finger landing and lifting
 * inside it all land here (specs/ui.md). Confirming on the title also remembers
 * the entry, which is what every later path back to the title restores.
 */
export function confirmMenuItem(state: State, index: number): CaromState {
  if (index < 0 || index >= menuItemCount(state.screen)) return state;
  switch (state.screen) {
    case "title": {
      const remembered: CaromState = { ...state, titleIndex: index };
      if (index === 0) return startMatch(remembered, "solo");
      if (index === 1) return startMatch(remembered, "versus");
      return { ...remembered, screen: "howto", menuIndex: 0 };
    }
    case "howto":
      return toTitle(state);
    case "paused":
      if (index === 0) return resumeMatch(state);
      if (index === 1) return startMatch(state, state.mode);
      return toTitle(state);
    case "matchover":
      if (index === 0) return startMatch(state, state.mode);
      return toTitle(state);
    case "countdown":
    case "playing":
      // Neither shows a menu, so neither has an item to confirm.
      return state;
  }
}
