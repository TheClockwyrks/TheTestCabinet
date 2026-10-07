// Deepcore — the scene the escape-rocket checks share.
//
// Not a suite: a `.ts` beside the suites, which the project never collects. It
// arranges what every rocket check arranges identically and decides nothing.
//
// WHERE A ROCKET CHECK STANDS. `specs/world.md` puts the Launch Pad in the camp
// and `specs/ui.md` puts the five-component checklist and its `FABRICATE` or
// `LAUNCH` inside that building's panel, so the miner is stood on the pad's
// footprint with the panel open. The footprint is asked of the build through
// `buildings()`, because where the six buildings sit along the camp is the
// build's to choose and no check may assume a layout.
//
// BOTH FACULTIES ARE HELD OFF. Nothing on the pad is about the miner's body or
// its drill, and `openScene` leaves an empty mine that the camp row would let the
// miner fall through, so the gates `specs/instrumentation.md` fixes hold it
// exactly where it was posed for as long as the check runs.
//
// THE HOLDINGS ARE POSED, NOT EARNED. `specs/rocket.md` fixes what each component
// costs in Credits and material; a check about fabricating poses exactly that and
// nothing else, so what it grades is the fabrication rather than the descent that
// would have paid for it.

import {
  openScene,
  pinDrill,
  pinMiner,
  standAtBuilding,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";

/** Open the scene every rocket check runs in: on the pad, with the panel up. */
export async function openPadScene(h: Harness): Promise<void> {
  await openScene(h);
  await standAtBuilding(h, "launch-pad");
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setPanel("launch-pad");
}

/**
 * How long one frame of a driven span covers, in seconds of game time.
 *
 * Twenty-five a second: fine enough that a span recorded as a review item's
 * replay plays back as motion rather than as a slideshow, and coarse enough that
 * a ninety-second timer is a few hundred rendered frames rather than ten
 * thousand. Nothing here depends on the division — `specs/instrumentation.md`
 * fixes that an interval of game time reaches the same state however it was cut
 * into frames.
 */
const FRAME_SECONDS = 0.04;

/** Run `seconds` of game time in whole frames of about {@link FRAME_SECONDS}. */
export function elapse(h: Harness, seconds: number): Promise<void> {
  return h.advanceSeconds(
    seconds,
    Math.max(2, Math.ceil(seconds / FRAME_SECONDS)),
  );
}

/** How long a scene waits for a screen to change before calling it unchanged. */
const WAIT_SECONDS = 8;

/** Run the game on until it leaves `screen`, or the wait runs out. */
export async function runUntilScreenLeaves(
  h: Harness,
  screen: DeepcoreSnapshot["screen"],
  maxSeconds: number = WAIT_SECONDS,
): Promise<DeepcoreSnapshot> {
  let elapsed = 0;
  let snapshot = await h.snapshot();
  while (snapshot.screen === screen && elapsed < maxSeconds) {
    await elapse(h, 0.25);
    elapsed += 0.25;
    snapshot = await h.snapshot();
  }
  return snapshot;
}
