// Arc Foundry — animation/press-cycle: the press ships a four-frame stamping
// cycle that is more than one picture repeated.
//
// THE REQUIREMENT, from the animation table of `specs/assets.md`: "Press —
// `press/0.png` .. `3.png` — the press stamping, played when a rock is placed."
// So this point asks both halves at once: the four files exist and decode, and
// the cycle they make is not one picture four times.
//
// WHAT A CYCLE HAS TO DELIVER, AND WHAT IT DOES NOT. `specs/assets.md` states the
// floor itself: "A body may be reused across tints; what the cycles must deliver
// is that the Load visibly crackles, a firing structure visibly charges and
// discharges, and the Dynamo visibly seethes." The press is not one of the three,
// so the only thing left standing over its frames is the table's own word for the
// cycle — the press STAMPING — and a cycle that holds two pictures stamps:
// hold, hold, strike, hold is a press that comes down once a loop. A cycle whose
// four frames are one picture shows no stamp however fast it is played, and that
// is the line this point draws.
//
// WHY BOTH HALVES ARE ONE POINT HERE. The press is a single cycle rather than a
// family of them, so "the press has a four-frame stamping cycle" is one
// requirement in one direction; the Load's and the components' cycles are split
// into a presence point and a distinctness point because each of those is a
// family and a build can miss one member of it without missing the other.
//
// No size is asserted: `specs/assets.md` fixes one for the Load's idle cycles and
// deliberately fixes none for the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";
import {
  cycleFrames,
  decodeAll,
  evidence,
  missing,
  onePicture,
} from "./images";

const FRAMES = cycleFrames("press");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces a stamping cycle that is more than one picture", async () => {
  await evidence(h, "press", async () => {
    await openYard(h);
    await standCandidate(h, "capacitor", 1, 24, 15);
    await h.advance(1);
  });

  assertDeepEqual(
    missing(FRAMES),
    [],
    "assets/press/0.png through 3.png on disk (specs/assets.md)",
  );
  const frames = await decodeAll(FRAMES);
  assertEqual(
    onePicture(frames),
    false,
    "whether the press's four frames are one picture repeated, which shows no " +
      "stamp however fast it is played (specs/assets.md)",
  );
});
