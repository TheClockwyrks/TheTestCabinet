// audio/swap-cue — the cue an exchange plays is `swap`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `swap` is played when "The loaded
// and queued cores are exchanged". `specs/assets.md` fixes what it must not be
// mistaken for — "a lighter flick, never mistaken by ear for `seat`" — which
// is why the two are separate cues and separate points.
//
// THE HALL. `audio/cues.ts`'s quiet hall, in which nothing else the cue table
// names can happen: nothing is fired, nothing is struck, nothing arrives at
// the intake, and the quota stands unexhausted so no clear follows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseHall,
  pressSwap,
  watchCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openHall, QUIET_CORES } from "./cues";

/** The charge the injector is posed holding loaded. */
const LOADED = "halide";

/** The charge it is posed holding queued, distinct from the loaded one. */
const QUEUED = "cobalt";

/** Ticks recorded after the exchange, so the clip shows what it left. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the swap cue on the tick the two cores are exchanged", async () => {
  await openHall(h);
  await poseHall(h, { cores: QUIET_CORES, loaded: LOADED, queued: QUEUED });

  const played = watchCues(h);
  const swapped = await captureReplay(h, "swap", async () => {
    const after = await pressSwap(h);
    const measured = { after, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertEqual(
    swapped.after.injector.loaded,
    QUEUED,
    "the loaded charge after the exchange, so the exchange really happened",
  );
  assertHeardOnce(
    swapped.cues,
    swapped.tick,
    "swap",
    "the swap cue on the tick the two cores were exchanged",
  );
});
