// presentation/bite-freezes-while-paused — the bite runs on the round's own time.
//
// specs/assets.md, of the head's bite: "It runs on the round's own time, so it
// holds the frame it is on while the game is paused and carries on from there
// when the round resumes." specs/ui.md puts the pause menu over a round "frozen
// behind" it with the board visible, and a head visibly chewing behind a frozen
// board is the thing this decides.
//
// WHY IT IS A POINT OF ITS OWN. `bite-starts-on-eat` and `bite-returns-to-rest`
// decide the two ends of the animation on a live round, and both pass on a build
// that drives the bite off the raw frame delta. Whether the bite is on the
// round's clock or on the runtime's is a third observable behaviour and shows
// only where the two clocks part, which on this game is the pause.
//
// WHAT IS READ. The identity of the image painted on the head's cell: the one it
// carried at the moment of the pause, against the one it carries after far more
// than `BITE_SECONDS` of paused time. The identities are the build's own — what
// is asserted is that the picture on that cell did not CHANGE, never that a
// particular file is on it.
//
// WHY THE FRAME IS READ IMMEDIATELY BEFORE THE PAUSE. The frames of a bite are
// distinct pictures (`presentation/head-frames-distinct`), so a bite that kept
// running behind the pause leaves a different one there — whichever of `2`, `3`
// or the resting `0` its own clock reached. Nothing is asserted about WHICH
// frame the pause caught, only that the pause held it.
//
// The pause is posed with `setScreen` rather than pressed for: a build whose
// pause key does not answer fails `states/pause-reachable` and `controls/*`, and
// must not lose this point as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { BITE_SECONDS } from "../../src/constants";
import {
  HOME_HEAD,
  arrangeEat,
  captureReplay,
  createHarness,
  secondFrames,
  type Harness,
} from "../harness";
import { headSprite } from "./bite";

/**
 * Frames of paused time the bite is held through: four times `BITE_SECONDS`.
 *
 * Well past the whole animation, so a bite driven off the raw frame delta has
 * run out and gone back to rest rather than merely moved on a frame.
 */
const PAUSED_FRAMES = secondFrames(BITE_SECONDS * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the head on the frame the pause caught it on", async () => {
  arrangeEat(h, { head: HOME_HEAD, dir: "right" });

  // What the head is painted with at rest, read off the build before the eat.
  const resting = await headSprite(h);
  assertNotNull(resting, "the sprite painted on the head cell at rest");

  await h.tick();
  // One further frame, so a build that begins drawing the bite on the frame
  // after the eat is read mid-bite like any other.
  const chewing = await headSprite(h);
  assertNotEqual(
    chewing,
    resting,
    "the sprite painted on the head cell while the bite is running",
  );

  const held = await captureReplay(h, "frozen", async () => {
    h.debug.setScreen("paused");
    await h.advance(PAUSED_FRAMES);
    return headSprite(h);
  });

  assertEqual(
    held,
    chewing,
    `the sprite on the head cell after ${BITE_SECONDS * 4} s of paused time`,
  );
});
