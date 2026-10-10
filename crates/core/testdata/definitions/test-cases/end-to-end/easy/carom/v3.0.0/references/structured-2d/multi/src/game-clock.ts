// Carom — the game's own simulation clock.
//
// `simTime` is the accumulator every update adds its delta time to, whatever
// the screen — the paused screen and the menus included — and it is the game's
// own rather than the engine's: `reset` returns it to zero and nothing else
// writes it (specs/state.md, specs/instrumentation.md). The engine's frame
// counter keeps running across a reset, so the two are not the same number and
// the trails, which stamp each sample with the simulation time, are stamped
// with this one.
//
// It lives on the game instance, because it outlives every level transition,
// and this actor is what advances it. Each level declares it FIRST, so the
// clock is already at this frame's value by the time the rally records a trail
// sample against it.

import { Actor } from "@clockwyrks/structured-2d";
import { gameOf } from "./state";

export class GameClock extends Actor {
  tick(dt: number): void {
    gameOf(this.world).simTime += dt;
  }
}
