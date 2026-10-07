// bays/fish-cleared-when-bay-filled — the hop that fills the bay a bonus catch is
// sitting in takes the catch off the strait.
//
// specs/bays.md: "A bonus catch leaves when it has lingered `FISH_LINGER`, or the
// moment its bay is filled, whichever comes first."
//
// THE CADENCE STAYS OFF, as `startCrossing` leaves it, and that is the isolation
// this point needs. `specs/instrumentation.md` is explicit that it may be: "A
// bonus catch posed through the surface still scores when its bay is filled." With
// the cadence off nothing can take the catch away on its own — no linger runs out
// and no next one arrives — so the fill is the only thing that can have cleared
// it, and a build whose catch merely happened to leave on time cannot pass here.
// The other five catch points are the ones whose requirement the cadence is.
//
// The catch is posed into the bay the critter then hops into. That the hop fills
// the bay at all is `bays/fill-on-entry`'s requirement; it is read here only as
// the situation, so a refused hop is not mistaken for a cleared catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOP_KEY } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The bay that holds the catch and takes the hop. */
const BAY = 3;

/** Ticks of the bay-fill hold recorded after the hop, for the replay alone. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the bonus catch off when its bay is filled", async () => {
  await startCrossing(h);
  await h.debug.setFishBay(BAY);
  await poseAtBayMouth(h, BAY);

  const posed = await h.snapshot();
  assertEqual(
    posed.fishBay,
    BAY,
    "the bonus catch, posed in the bay to be filled",
  );

  const taken = await captureReplay(h, "fill", async () => {
    await h.tap(HOP_KEY.up);
    const landed = await h.snapshot();
    await h.advance(AFTER_TICKS);
    return landed;
  });

  assertEqual(taken.bays[BAY], true, `bay ${BAY} filled by the hop`);
  assertNull(taken.fishBay, "the bonus catch, after its bay was filled");
});
