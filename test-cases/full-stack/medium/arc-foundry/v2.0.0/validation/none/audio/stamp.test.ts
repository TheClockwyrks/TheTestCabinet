// Arc Foundry — audio/stamp: the stamp cue sounds when a rock lands, and on no
// frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.stamp` is played when
// "a rock lands and rolls", and each cue is played "on the update its event
// happens, and at most once on that update".
//
// WHY THIS ONE IS COUNTED ACROSS THE CALL RATHER THAN READ OFF A FRAME. A rock
// landing is a CONTROL's event: `specs/scrap-press.md` has the roll happen "the
// instant it lands", and `specs/instrumentation.md` has `placeRock` drop the rock
// "through the real placement path" at the call. A build may sound the cue there or
// on the update that follows, and the specification fixes nothing finer than "the
// update its event happens" — so what is counted is every sound emitted across the
// drop and the frame after it, and a build is free to do either.
//
// THE RUN-UP IS HELD SILENT. The yard is emptied and a tenth of a second of it is
// driven before the drop, where the specification names no event at all, so a
// build that blips every frame fails there rather than passing on the drop.
//
// WHAT CANNOT BE SEPARATED. A build that plays the WRONG cue on the right event;
// the name of a sound is not observable from outside an engineless build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { RUN_UP, firstSound, sounds } from "./cues";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 18 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds when the rock lands, and not over the frames before it", async () => {
  await openYard(h, { wave: 1 });
  await firstSound(h);

  const opening = await sounds(h);
  await h.advance(RUN_UP);
  const settled = await sounds(h);

  const drop = await captureReplay(h, "stamp", async () => {
    await h.debug.placeRock(ANCHOR.col, ANCHOR.row);
    await h.advance(1);
    return { landed: await sounds(h), yard: await h.snapshot() };
  });

  assertEqual(
    settled - opening,
    0,
    "nothing to sound over the frames before the rock is dropped, where the " +
      "specification names no event (specs/ui.md)",
  );
  assertEqual(
    drop.yard.structures.length,
    1,
    "placeRock to land one candidate on the yard (specs/instrumentation.md)",
  );
  assertGreaterThan(
    drop.landed - settled,
    0,
    "a cue to sound when a rock lands and rolls (specs/ui.md)",
  );
});
