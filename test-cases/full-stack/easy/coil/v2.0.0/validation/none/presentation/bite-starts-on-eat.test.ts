// presentation/bite-starts-on-eat — eating a pellet puts something other than
// the resting head on the head's cell.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md`: "Frame `0` is what the head
// shows at all times except during a bite. The tick that eats a pellet starts a
// bite, which plays frames `1`, `2`, and `3` in order over `BITE_SECONDS`
// (`0.25`) and then returns the head to frame `0`." This point decides the
// first half of that — the bite starts. That it ENDS, and that the head then
// stays at rest, is `presentation/bite-returns-to-rest`.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. The identity of the image
// painted on the head's cell, frame by frame, over the `BITE_SECONDS` following
// the eat, against the identity that was on it while the head was at rest. The
// resting identity is taken from the build itself, before the eat, rather than
// assumed to be a particular file: `specs/assets.md` fixes the four paths but
// leaves a build free to name and order the images it loads them into, so what
// can honestly be read is that the head STOPPED being painted with the picture
// it rests on. That the four files differ from one another at all is
// `presentation/head-frames-distinct`, and which pose each one holds is the
// presentation domain's aesthetic rating.
//
// It is not read that frames `1`, `2` and `3` arrive in that order. The order is
// stated, but which file a build loaded into which slot is not observable from
// outside, so an ordering check would be reading the build's own load order back
// to it rather than the specification.
//
// THE WORLD THIS POSES. A chain with the pellet one cell ahead of the head and
// nothing else on the board: the obstacle course cleared, the pellet's respawn
// switched off so the eat is the only eat in the drive, and a long runway east
// of the head so the chain travels through the whole bite without meeting a wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, fail } from "../assert";
import { BITE_SECONDS } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  HOME_HEAD,
  secondFrames,
  type Harness,
} from "../harness";
import { headSprite } from "./bite";

/** Frames of the harness's clock `BITE_SECONDS` of game time covers: sixteen. */
const BITE_FRAMES = secondFrames(BITE_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the head with something other than its resting frame after an eat", async () => {
  await arrangeEat(h, { head: HOME_HEAD, dir: "right" });

  // What the head is painted with at rest, read off the build before anything
  // is eaten. A reset leaves no bite playing, so this is frame `0`.
  const resting = await headSprite(h);
  assertNotNull(resting, "the sprite painted on the head cell at rest");

  const bite = await captureReplay(h, "bite", async () => {
    const eaten = await h.tick();
    const painted: (string | null)[] = [];
    for (let frame = 0; frame < BITE_FRAMES; frame += 1) {
      painted.push(await headSprite(h));
    }
    return { eaten, painted };
  });

  // The drive reached the eat: with the respawn switched off, an eaten pellet
  // leaves the board without one.
  assertNull(bite.eaten.pellet, "the pellet after the tick that ate it");

  const other = bite.painted.filter((id) => id !== null && id !== resting);
  if (other.length === 0) {
    fail(
      "the head cell painted with an image other than its resting frame on some" +
        " frame within BITE_SECONDS (0.25 s) of the eat",
      `all ${bite.painted.length} frames painted ${String(resting)}`,
    );
  }
});
