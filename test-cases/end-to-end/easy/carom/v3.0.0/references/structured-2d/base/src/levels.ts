// Carom — the level registry's two entries, under the names `LEVELS` fixes.
//
// A level is not a screen here. All six screens are hosted by whichever world
// is open (`src/carom-mode.ts`), because specs/instrumentation.md makes
// `setScreen` an atomic pose that leaves the world alone. What the two levels
// name is the two ways a world is STARTED, and each is an arrangement
// specs/ui.md fixes in full:
//
//   * `title` — the level the engine opens first, and the level every path back
//     to the title opens: the game on its title screen with every declared
//     field at its title value.
//   * `match` — the level SOLO, VERSUS, RESTART and PLAY AGAIN open: a fresh
//     match on its pre-serve countdown, in the mode the transition names.
//
// Both place the same field, because both show the same court: the net and the
// chrome that draws whichever screen is up. The paddles arrive through
// possession, and the ball and the obstacles are spawned by the mode — they are
// the entities `clearWorld`, `spawnBall` and `spawnObstacle` add and remove, so
// the level cannot be the thing that decides they are there.

import type { LevelDefinition } from "@test-cabinet/structured-2d";
import { MatchLevelMode, TitleLevelMode } from "./carom-mode";
import { Hud } from "./hud";
import { Net } from "./scenery";
import { Chrome } from "./screens";

/** Everything both levels place: the net, the HUD, and the screen chrome. */
const field = [{ type: Net }, { type: Hud }, { type: Chrome }] as const;

export const title: LevelDefinition = {
  mode: TitleLevelMode,
  actors: [...field],
};

export const match: LevelDefinition = {
  mode: MatchLevelMode,
  actors: [...field],
};
