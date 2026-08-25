// Carom (Gyre) — the level registry's two entries (src/constants.ts fixes the
// names): `title`, the menu level the engine opens first, and `match`, the
// level a match plays in.
//
// Each level declares the actors it places. The field furniture — the net and
// the two obstacles — is shared: the title screen shows the court dimmed
// behind its menu, so both levels place the same pieces and the components dim
// themselves by the screen. Each obstacle is configured with its index into
// `OBSTACLE_CENTERS` and starts on its base center: the clock-zero, upright
// pose, which the title keeps (its world has no obstacle clock) and which a
// fresh match opens on before the clock starts winding (src/scenery.ts). The
// title level also places the two paddles and a parked ball as furniture, each
// under its case-fixed tag, so the court a player sees behind the menu is the
// same court `world.byTag` reports; in the match level the paddles arrive
// through possession instead — the mode spawns one per participant — and the
// mode spawns the ball last so it ticks after them (src/match-mode.ts).

import type { ActorSpec, LevelDefinition } from "@test-cabinet/structured-2d";
import { Ball } from "./ball";
import { FIELD_CX, FIELD_CY, OBSTACLE_CENTERS, TAGS } from "./constants";
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
    ...OBSTACLE_CENTERS.map((center, index): ActorSpec<Obstacle> => ({
      type: Obstacle,
      transform: { x: center.x, y: center.y },
      tags: [TAGS.obstacle],
      configure: (obstacle: Obstacle) => {
        obstacle.index = index;
      },
    })),
  ];
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
    { type: Ball, transform: { x: FIELD_CX, y: FIELD_CY }, tags: [TAGS.ball] },
    { type: TitleDisplay },
  ],
};

export const match: LevelDefinition = {
  mode: MatchMode,
  actors: [...furniture(), { type: Hud }, { type: MatchChrome }],
};
