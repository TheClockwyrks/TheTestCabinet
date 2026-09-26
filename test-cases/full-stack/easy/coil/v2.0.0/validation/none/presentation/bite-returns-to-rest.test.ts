// presentation/bite-returns-to-rest — the bite ends, and the head goes back to
// the picture it rests on.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md`: "Frame `0` is what the head
// shows at all times except during a bite. The tick that eats a pellet starts a
// bite, which plays frames `1`, `2`, and `3` in order over `BITE_SECONDS`
// (`0.25`) and then returns the head to frame `0`." This point decides the
// second half of that: past `BITE_SECONDS` the head is at rest again, and it
// stays there. That the bite STARTS is `presentation/bite-starts-on-eat`.
//
// WHAT IS READ. The identity of the image painted on the head's cell, once past
// `BITE_SECONDS` from the eat and then once a tick for several ticks after,
// against the identity that was on it before the eat. The resting identity is
// taken from the build itself rather than assumed to be a particular file, for
// the reason `presentation/bite-starts-on-eat` sets out: `specs/assets.md` fixes
// the four paths, not which image a build loads each into.
//
// WHERE THE FIRST READING FALLS. `BITE_SECONDS` is `0.25` s, which is sixteen
// frames of this project's 64 Hz clock and exactly two ticks, so the boundary
// itself is a frame rather than a fraction of one. The drive advances that many
// frames from the end of the eating tick and then reads on the frame AFTER them,
// which is strictly past `BITE_SECONDS` however far inside the tick the eat
// resolved — so a build that returns the head at exactly `BITE_SECONDS` and one
// that returns it on the following frame both pass, and one still biting a whole
// tick later does not.
//
// THE WORLD THIS POSES. A chain with the pellet one cell ahead and nothing else
// on the board, the pellet's respawn switched off so no second eat restarts the
// bite, and a runway east long enough for the whole drive to travel without
// meeting a wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { BITE_SECONDS } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  FRAMES_PER_TICK,
  HOME_HEAD,
  secondFrames,
  type Harness,
} from "../harness";
import { headSprite } from "./bite";

/** Frames of the harness's clock `BITE_SECONDS` of game time covers: sixteen. */
const BITE_FRAMES = secondFrames(BITE_SECONDS);

/**
 * Ticks the head is watched for after the bite has ended.
 *
 * "Stays on it until the next eat" is what is being read, and nothing else in
 * the drive eats, so any span answers it; four ticks is half a second of play,
 * which is long enough to catch a build that loops the bite and short enough
 * that the chain stays well clear of the wall it is travelling toward.
 */
const REST_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the head back on its resting frame after BITE_SECONDS, and leaves it there", async () => {
  await arrangeEat(h, { head: HOME_HEAD, dir: "right" });

  const resting = await headSprite(h);
  assertNotNull(resting, "the sprite painted on the head cell at rest");

  const rest = await captureReplay(h, "rest", async () => {
    const eaten = await h.tick();
    // Past the whole of BITE_SECONDS, measured from the end of the tick that
    // ate — which is at or after the frame the eat resolved on.
    await h.advance(BITE_FRAMES);
    const painted: (string | null)[] = [];
    for (let tick = 0; tick < REST_TICKS; tick += 1) {
      painted.push(await headSprite(h));
      await h.advance(FRAMES_PER_TICK - 1);
    }
    return { eaten, painted };
  });

  // The drive reached the eat: with the respawn switched off, an eaten pellet
  // leaves the board without one.
  assertNull(rest.eaten.pellet, "the pellet after the tick that ate it");

  for (let tick = 0; tick < rest.painted.length; tick += 1) {
    assertEqual(
      rest.painted[tick],
      resting,
      `the sprite painted on the head cell ${tick} ticks past BITE_SECONDS (0.25 s) after the eat`,
    );
  }
});
