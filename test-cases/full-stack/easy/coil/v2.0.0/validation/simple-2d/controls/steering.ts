// Coil — pressing one steering key over an isolated chain. CASE-PROVIDED.
//
// The eight steering points differ in exactly two things: the key pressed and the
// direction the snake is expected to be travelling in a tick later. Everything
// around them is the same arrangement, and it is written once here so the eight
// suites cannot drift apart into eight slightly different questions.
//
// WHAT IS PRESSED, AND WHY IT IS A KEY RATHER THAN AN OPERATION.
// specs/instrumentation.md gives the surface no keyboard operation at all: the
// keyboard belongs to the engine, the build registers the actions
// `specs/controls.md` fixes and reads one press edge per action per frame from
// it, and a check steers by dispatching a keyboard-shaped event carrying the
// key's `code` at the listener the engine subscribed to. So what is graded is the
// whole path from a key event, through the engine's action mapping and the
// build's own reading of that edge, into the turn buffer and out of step 1 of the
// tick. `h.tap` runs exactly one frame between the press and the release, because
// the engine discards an edge nothing consumed by the end of the frame it was
// armed in.
//
// WHAT IS POSED, AND WHY TRAVEL IS OFF. specs/instrumentation.md's driver has
// three switches so a scenario can hold one faculty still while it watches
// another, and a steering point is about steering: with `travel` off "a buffered
// turn is still taken and `dir` still changes", while the chain holds the cells it
// stands on. So the snake cannot reach a wall, cannot reach its own body, and
// cannot eat anything, and the only thing the tick can do is the one thing this
// is about. The board is cleared of the pellet and of the obstacle course for the
// same reason.

import {
  HOME_HEAD,
  captureReplay,
  chainFrom,
  poseScene,
  type CoilSnapshot,
  type Dir,
  type Harness,
} from "../harness";

/** What one steering press left: the world it was made in, and the tick after. */
export interface SteerDrive {
  posed: CoilSnapshot;
  after: CoilSnapshot;
}

/** Cells of the posed chain: enough to read as a snake, short enough to be clear. */
const LENGTH = 3;

/**
 * Pose a chain facing `from`, press `key`, and run the one tick that applies it.
 *
 * The drive — the press and the tick it resolves on — is what the replay keeps,
 * so the evidence is the steering rather than the arrangement before it.
 */
export async function steerOnce(
  h: Harness,
  key: string,
  from: Dir,
  outputId: string,
): Promise<SteerDrive> {
  const posed = poseScene(h, {
    snake: chainFrom(HOME_HEAD, from, LENGTH),
    dir: from,
    pellet: null,
    travel: false,
  });
  const after = await captureReplay(h, outputId, async () => {
    await h.tap(key);
    return h.tick();
  });
  return { posed, after };
}
