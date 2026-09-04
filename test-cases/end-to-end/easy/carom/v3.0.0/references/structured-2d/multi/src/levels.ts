// Carom — the level registry's two entries (src/constants.ts fixes the names):
// `title`, the menu level the engine opens first, and `match`, the level a
// match plays in.
//
// Each level declares only what does not come and go: the simulation clock
// (first, so it is already at this frame's value when the rally stamps a trail
// sample against it), the decorative net, and the screen chrome. The BALLS and
// the OBSTACLES are declared by neither, because which of them is on the field
// is state (specs/state.md) — `clearWorld` takes them off and `spawnBall` and
// `spawnObstacle` put them back — so each level's game mode spawns the standard
// field as it begins play (src/field.ts).
//
// The paddles differ, and that is the levels' real difference. The title level
// places two as furniture, standing where the title-screen state says; the
// match level's arrive through possession, one per participant, from the mode.

import type { ActorSpec, LevelDefinition } from "@test-cabinet/structured-2d";
import { FIELD_CY, TAGS } from "./constants";
import { GameClock } from "./game-clock";
import { Hud } from "./hud";
import { MatchMode } from "./match-mode";
import { Paddle } from "./paddle";
import { Net } from "./scenery";
import { paddleCenterX, type Side } from "./sim";
import { MatchChrome, TitleDisplay } from "./screens";
import { TitleMode } from "./title-mode";

/** The two pieces every world has, in the order they must tick and draw. */
function shared(): ActorSpec[] {
  return [{ type: GameClock }, { type: Net }];
}

/** One of the title level's two unpossessed paddles, on its own side. */
function furniturePaddle(side: Side): ActorSpec<Paddle> {
  return {
    type: Paddle,
    transform: { x: paddleCenterX(side), y: FIELD_CY },
    tags: [side === "left" ? TAGS.paddleLeft : TAGS.paddleRight],
    configure: (paddle: Paddle) => {
      paddle.side = side;
    },
  };
}

export const title: LevelDefinition = {
  mode: TitleMode,
  actors: [
    ...shared(),
    furniturePaddle("left"),
    furniturePaddle("right"),
    { type: TitleDisplay },
  ],
};

export const match: LevelDefinition = {
  mode: MatchMode,
  actors: [...shared(), { type: Hud }, { type: MatchChrome }],
};
