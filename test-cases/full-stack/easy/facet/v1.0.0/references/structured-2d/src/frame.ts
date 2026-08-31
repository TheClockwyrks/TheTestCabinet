// Facet — one frame of simulation, from the game mode's tick.
//
// `FacetMode.tick` runs after every controller and actor has ticked, so this
// module sees the state the frame's input already wrote and carries it forward
// by the frame's delta. That is the whole of the per-frame simulation: the
// core's own `tick` accumulates `simTime` on every screen and advances the
// board, the chain, its step timer, and the refusal mark on `playing` alone
// (specs/ui.md, What advances on each screen). The batching, the per-step
// reports, and the slicing that keeps a long frame reporting every step it
// crossed are in `src/steps.ts`.
//
// THE FRAME IS WHERE CUES ARE PLAYED, once each, from the merged flags of
// everything that raised one: the player controller's batch, taken here, and
// the chain's own. That merge is why they are played from the mode rather than
// from each place that raises one — a swap that clears in the controller and a
// second step that clears in the same frame's chain are one `clear`, not two
// (specs/ui.md). A pose of the debug surface is not a frame and plays nothing.

import type { World } from "@test-cabinet/structured-2d";
import { playFrameEvents, updateMusic } from "./audio";
import { assets } from "./assets";
import { Bench } from "./bench";
import { applyCore, toCore } from "./bridge";
import { FacetController } from "./controller";
import type { FacetState } from "./game";
import { advanceTime, openBatch } from "./steps";
import { mergeEvents, NO_EVENTS } from "./core";

/**
 * The whole of one frame's simulation.
 *
 * The state is read into the core's shape, carried forward, and written back in
 * place; the cues the frame raised are played once each; and the chain steps it
 * resolved — the controller's included — are handed to the presentation, in the
 * order they resolved.
 */
export function advanceFrame(
  world: World,
  state: FacetState,
  dt: number,
): void {
  // The controller ticked before this, so its batch is this frame's too.
  const player = world.players()[0];
  const fromInput =
    player instanceof FacetController ? player.takeBatch() : null;

  const batch = advanceTime(openBatch(toCore(state)), dt);
  applyCore(state, batch.state);

  const events = mergeEvents(fromInput?.events ?? NO_EVENTS, batch.events);
  const rung = Math.max(fromInput?.rung ?? 0, batch.rung);
  playFrameEvents(world.audio, events, rung);
  updateMusic(world.audio, state.screen);

  const presentation = world.find(Bench)?.presentation;
  if (presentation !== undefined) {
    // A completed level deals a whole new board, so whatever is still flying
    // belongs to a board that is gone.
    if (events.levelUp) presentation.clear();
    presentation.push([...(fromInput?.steps ?? []), ...batch.steps], assets());
  }
}
