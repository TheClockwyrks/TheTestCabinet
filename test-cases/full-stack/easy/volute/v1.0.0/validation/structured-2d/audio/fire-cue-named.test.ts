// audio/fire-cue-named — the cue the injector's shot plays is `fire`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): the cue table binds `fire` to "The
// injector fires a core", under "Define and play exactly the fifteen cues
// below, under exactly these names, one per event".
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. The identity alone. That a cue
// sounds on the firing tick at all is `audio/fire-cue`'s point, which every
// engine of this case decides; a build that sounds the intake's rumble when it
// fires passes that one and fails this.
//
// THE HALL. `audio/cues.ts` poses one core at the bottom of the field, which
// the shot flies away from, with the inlet held and the quota unexhausted — so
// no insertion, no extraction, no arrival, no clear and no grant can sound
// beside the shot.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  pressFire,
  watchCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openQuietHall } from "./cues";

/** Ticks recorded after the release, so the clip shows the core fly. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the fire cue on the tick the injector fires", async () => {
  await openQuietHall(h);

  const played = watchCues(h);
  const shot = await captureReplay(h, "fire", async () => {
    const after = await pressFire(h);
    const measured = { after, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertGreaterThan(
    shot.after.projectiles.length,
    0,
    "the projectiles the fire control put in the hall",
  );
  assertHeardOnce(
    shot.cues,
    shot.tick,
    "fire",
    "the fire cue on the tick the injector fired",
  );
});
