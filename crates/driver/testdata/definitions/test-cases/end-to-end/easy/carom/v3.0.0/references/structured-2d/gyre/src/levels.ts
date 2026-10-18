// Carom (Gyre) — the level registry's two entries (src/constants.ts fixes the
// names): `title`, the menu level the engine opens first, and `match`, the
// level a match plays in. Which of Carom's six screens each one hosts is
// `src/state.ts`'s `levelOf`.
//
// A level declares only what is CONSTANT about it. The net is decoration and
// belongs to both. The paddles are the title level's furniture — the court a
// player sees dimmed behind the menu is the same court `world.byTag` reports —
// and the match level's pawns, which arrive through possession because the mode
// seats their drivers (src/match-mode.ts).
//
// WHAT NEITHER LEVEL PLACES IS THE BALL OR THE OBSTACLES. Whether either is on
// the field is STATE (specs/state.md): `clearWorld` removes them and
// `spawnBall`/`spawnObstacle` put them back, and a field a scenario cleared
// stays cleared across a level transition. So the instance places them as it
// dresses each incoming world, from the carry that says what survived
// (src/carry.ts) — after the mode's `beginPlay` has seated the paddles, which
// is also what puts the ball last in spawn order so it ticks after them.

import type { ActorSpec, LevelDefinition } from "@clockwyrks/structured-2d";
import { FIELD_CY, TAGS } from "./constants";
import { Hud } from "./hud";
import { MatchMode } from "./match-mode";
import { Paddle } from "./paddle";
import { Net } from "./scenery";
import { paddleCenterX, type Side } from "./sim";
import { Chrome } from "./screens";
import { TitleMode } from "./title-mode";

/** A paddle standing as the title level's furniture, under its own tag. */
function paddle(side: Side): ActorSpec<Paddle> {
  return {
    type: Paddle,
    transform: { x: paddleCenterX(side), y: FIELD_CY },
    tags: [side === "left" ? TAGS.paddleLeft : TAGS.paddleRight],
    configure: (actor: Paddle) => {
      actor.side = side;
    },
  };
}

export const title: LevelDefinition = {
  mode: TitleMode,
  actors: [{ type: Net }, paddle("left"), paddle("right"), { type: Chrome }],
};

export const match: LevelDefinition = {
  mode: MatchMode,
  actors: [{ type: Net }, { type: Hud }, { type: Chrome }],
};
