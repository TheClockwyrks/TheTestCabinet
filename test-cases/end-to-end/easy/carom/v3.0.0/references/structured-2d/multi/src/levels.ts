// Carom — the level registry's two entries (src/constants.ts fixes the names):
// `title`, the menu level the engine opens first, and `match`, the level a
// match plays in.
//
// Each level declares the actors it places. The field furniture — the net and
// the two obstacles — is shared: the title screen shows the court dimmed
// behind its menu, so both levels place the same pieces and the components dim
// themselves by the screen. The title level also places the two paddles and
// the three parked balls as furniture, each under its case-fixed tag and the
// balls in play order, so the court a player sees behind the menu is the same
// court `world.byTag` reports; in the match level the paddles arrive through
// possession instead — the mode spawns one per participant — and the mode
// spawns the balls and then the rally, so the frame's flight runs after every
// paddle and every hold (src/match-mode.ts).

import type { ActorSpec, LevelDefinition } from "@test-cabinet/structured-2d";
import { Ball } from "./ball";
import { BALL_HOMES, FIELD_CY, OBSTACLE_CENTERS, TAGS } from "./constants";
import { Hud } from "./hud";
import { MatchMode } from "./match-mode";
import { Paddle } from "./paddle";
import { Net, Obstacle } from "./scenery";
import { paddleCenterX } from "./sim";
import { TitleDisplay, MatchChrome } from "./screens";
import { TitleMode } from "./title-mode";

/** The net and the two obstacles, in `OBSTACLE_CENTERS` order (A then B). */
function furniture(): ActorSpec[] {
  return [
    { type: Net },
    ...OBSTACLE_CENTERS.map((center): ActorSpec<Obstacle> => ({
      type: Obstacle,
      transform: { x: center.x, y: center.y },
      tags: [TAGS.obstacle],
    })),
  ];
}

/** The three balls parked on their homes, in play order, unheld: furniture. */
function parkedBalls(): ActorSpec[] {
  return BALL_HOMES.map((home, index): ActorSpec<Ball> => ({
    type: Ball,
    transform: { x: home.x, y: home.y },
    tags: [TAGS.ball],
    configure: (ball: Ball) => {
      ball.index = index;
    },
  }));
}

export const title: LevelDefinition = {
  mode: TitleMode,
  actors: [
    ...furniture(),
    {
      type: Paddle,
      transform: { x: paddleCenterX("left"), y: FIELD_CY },
      tags: [TAGS.paddleLeft],
      configure: (paddle: Paddle) => {
        paddle.side = "left";
      },
    },
    {
      type: Paddle,
      transform: { x: paddleCenterX("right"), y: FIELD_CY },
      tags: [TAGS.paddleRight],
      configure: (paddle: Paddle) => {
        paddle.side = "right";
      },
    },
    ...parkedBalls(),
    { type: TitleDisplay },
  ],
};

export const match: LevelDefinition = {
  mode: MatchMode,
  actors: [...furniture(), { type: Hud }, { type: MatchChrome }],
};
