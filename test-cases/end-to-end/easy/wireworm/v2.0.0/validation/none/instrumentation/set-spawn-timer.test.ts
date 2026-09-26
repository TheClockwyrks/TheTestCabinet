// Wireworm — instrumentation/set-spawn-timer: `setSpawnTimer` poses the seconds
// left on the level's clock for one foe kind, reads back, and the entry lands
// when the posed clock runs out.
//
// specs/instrumentation.md, The level's draws: `setSpawnTimer(kind, seconds)`
// "Sets the seconds left on the level's clock for `kind` ... until the next
// glitch enters ... The clock then runs and is redrawn exactly as
// `specs/foes.md` states", and the snapshot reports the clock as `glitchTimer`.
// specs/foes.md fixes what a running clock does: it "counts down against each
// update's delta while the level's play is active and its foe spawning is
// running. When a clock reaches `0` its kind's entry or check happens".
//
// THE CLOCK IS POSED WELL INSIDE ITS OWN RANGE'S SHADOW. specs/foes.md draws a
// fresh glitch clock uniformly between GLITCH_MIN_INTERVAL (7 s) and
// GLITCH_MAX_INTERVAL (12 s), so a build that ignores the pose and draws its
// own brings no glitch in before 7 s, and the reading at 1.6 s names it. The
// read-back is taken first, with no frame between the pose and the snapshot.
//
// THE READING IS TAKEN TWICE, EITHER SIDE OF THE POSED MOMENT. At 1.4 s the
// roster holds no glitch, so a build that fires a posed clock at once fails
// there; at 1.6 s it holds one, so a build whose clock never runs fails there.
// A tenth of a second either way is ten frames of the suite's clock, which is
// room for a build that fires on the update the clock crosses zero rather than
// the one it lands on.
//
// THE BOARD IS OTHERWISE EMPTY AND QUIET. `startPlaying` clears the rosters and
// holds worm entry and the cursor's contact off; foe spawning is turned back on
// because the entry the clock decides is this point's requirement, and at level
// 2 the glitch's clock is the only one running (specs/foes.md).

import { afterEach, beforeEach, it } from "vitest";
import {
  GLITCH_FROM_LEVEL,
  GLITCH_MAX_INTERVAL,
  GLITCH_MIN_INTERVAL,
} from "../constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  foesOfKind,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The seconds posed on the glitch's clock. */
const POSED_SECONDS = 1.5;

/** The two moments the roster is read at, either side of the posed one. */
const BEFORE_SECONDS = 1.4;
const AFTER_SECONDS = 1.6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads the posed clock back and brings the glitch in when it runs out", async () => {
  await startPlaying(h, { level: GLITCH_FROM_LEVEL });
  await h.debug.setFoeSpawning(true);
  await h.debug.setSpawnTimer("glitch", POSED_SECONDS);

  assertEqual(
    (await h.snapshot()).glitchTimer,
    POSED_SECONDS,
    `snapshot().glitchTimer after setSpawnTimer("glitch", ${POSED_SECONDS})`,
  );

  await h.advance(framesFor(BEFORE_SECONDS));
  const early = await h.snapshot();

  await h.advance(framesFor(AFTER_SECONDS - BEFORE_SECONDS));
  const late = await h.snapshot();
  // Before the assertions, so a failing pose still leaves the picture of the
  // board the clock was read on.
  await captureStill(h, "arrival");

  assertLength(
    foesOfKind(early, "glitch"),
    0,
    `glitches on the board ${BEFORE_SECONDS} s after a clock posed at ` +
      `${POSED_SECONDS} s — the clock runs down against each update's delta ` +
      `and the entry lands when it reaches 0 (specs/foes.md)`,
  );
  assertGreaterThan(
    foesOfKind(late, "glitch").length,
    0,
    `glitches on the board ${AFTER_SECONDS} s after a clock posed at ` +
      `${POSED_SECONDS} s — a clock drawn afresh instead would run ` +
      `GLITCH_MIN_INTERVAL (${GLITCH_MIN_INTERVAL} s) to GLITCH_MAX_INTERVAL ` +
      `(${GLITCH_MAX_INTERVAL} s), and a clock that never runs brings nothing`,
  );
});
