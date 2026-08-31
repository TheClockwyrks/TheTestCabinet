// rocks/split-small — a Small destroyed leaves nothing behind.
//
// `specs/rocks.md`, Splitting: the ladder's bottom rung gives `small` "Nothing",
// and the paragraph under it turns that into the rule the whole wave loop rests on
// — "since a `large` and a `medium` each leave two behind, the number of rocks on
// the field falls only when a `small` is destroyed". This item decides the bottom
// rung in one direction: the field is one rock shorter and holds no new one.
//
// THE FIELD HOLDS THE SMALL AND NOTHING ELSE, so the count is the whole reading.
// `startPlaying` empties every roster and shuts both world gates, one Small is
// posed at rest on the field's lower left, `412` units from the star, and the
// round is placed on its doorstep on the side facing away from the star so
// `specs/collision.md`'s absorption at the core cannot take it on the way in. The
// field therefore holds exactly one rock before the round lands and must hold
// exactly none after it.
//
// A ROSTER LENGTH RATHER THAN A COUNT OF SMALLS, because "no new one" is a
// statement about every size. A build that pays for the bottom rung with two
// fragments of some other size has a roster of two and passes a count of Smalls;
// it fails here.
//
// Under `warhead` a Small carries `ROCK_HEALTH.small` (`1`) hit, so the first round
// destroys it under either variant; the kill is driven by rounds all the same, so
// one script serves both checklists.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { QUIET_GROUND, killRock, poseRockAt } from "./scene";

/** How many rocks the field holds once the one Small on it has been destroyed. */
const EMPTY = 0;

/** Seconds of the emptied field, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the field one rock shorter and holding no new one", async () => {
  await startPlaying(h);
  const small = await poseRockAt(h, "small", QUIET_GROUND);

  const kill = await killRock(h, small);

  await h.advance(AFTERMATH_TICKS);
  await captureStill(h, "split");

  assertEqual(
    kill.before.rocks.length,
    1,
    "rocks on the field on the tick before the round landed (specs/instrumentation.md)",
  );
  assertEqual(
    kill.at.rocks.length,
    EMPTY,
    "rocks of any size left on the tick the Small was destroyed (specs/rocks.md)",
  );
});
