// machinery/grant-tailmost-mark — an extracted run carrying two marks leaves the
// tail-most one's machinery active.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Granting"): "When one extracted
// run carries more than one marked core, each is granted in train order from the
// head, so the mark nearest the tail decides what is left active." That is a rule
// of its own: `machinery/grant-on-extraction` decides that a mark grants at all,
// and this decides which of two survives. A build that grants only the first mark
// it finds, or that grants them in tail-to-head order, gets one right and the
// other wrong.
//
// THE POSE. Three cores of one charge on the straight top run, the head-most
// carrying a `choke` mark and the tail-most a `sightline`. The two kinds differ
// and both are timed, so exactly one of them can be the active machinery
// afterwards and the reading names which. `sightline` is the tail-most because it
// is the one that must win; a build granting head-last would leave `choke`.
//
// THE DRIVE. A matching core is fired into the run, which `specs/extraction.md`
// ("Extraction on an insertion") extracts as one maximal same-charge run of four.
// The train is HELD while the shot flies (`specs/instrumentation.md`, `setFeed`),
// so the three cores stand exactly where they were posed when the projectile
// reaches them and no rate this point does not grade decides where the shot lands.
//
// WHERE THE SHOT GOES. Straight up the field at the opening aim of 270 degrees
// from the injector's fixed centre at `(420, 330)` (`specs/injector.md`), which
// crosses leg 0 — `specs/channel.md`'s first leg, from `(40, 40)` to `(920, 40)` —
// at `x = 420`. The middle core is posed there, so the shot strikes one of the
// three whatever a build's arithmetic, and `specs/injector.md`'s insertion leaves
// all four consecutive at the channel spacing either way.
//
// THE TOLERANCES. The kind is an equality, not a measurement. The seconds left
// are read on the tick of the grant, before any timer has fallen, against the
// case's standing +/- 2 ticks on a duration — so the reading also catches a build
// that leaves the tail-most kind active at the head-most one's remaining.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  INJECTOR,
  MACHINERY_DURATION,
  MIN_RUN,
  OPENING_AIM,
  SPACING,
  TICK_DT,
  TICK_TOL,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  fireAt,
  markedCores,
  poseHall,
  spacedRun,
  topRunS,
  type Harness,
} from "../harness";

/** The charge the run and the fired core carry, so the four are one run. */
const CHARGE = "halide";

/** The mark on the head-most core: granted first, and so overwritten. */
const HEAD_MARK = "choke";

/** The mark on the tail-most core: granted last, and so left active. */
const TAIL_MARK = "sightline";

/** The head of the posed run: one spacing ahead of the injector's own arc. */
const HEAD_S = topRunS(INJECTOR.x) + SPACING;

/** How far the shot's whole flight may run before the check calls it lost. */
const FLIGHT_TICKS = 120; // 2 s, against a flight of about 28 ticks

/** Ticks kept in the replay after the grant, so the clip shows what it left. */
const SETTLE_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the tail-most mark's ${TAIL_MARK} active when one run carries two marks`, async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    feed: false,
    cores: spacedRun(
      HEAD_S,
      [CHARGE, CHARGE, CHARGE],
      [HEAD_MARK, null, TAIL_MARK],
    ),
    loaded: CHARGE,
  });

  const posed = h.snapshot();
  assertEqual(coreCount(posed), MIN_RUN, "the three cores the pose put up");
  assertLength(markedCores(posed), 2, "the marked cores the pose put up");
  assertEqual(
    posed.machinery,
    null,
    "the active machinery before the extraction",
  );

  const granted = await captureReplay(h, "tailmost", async () => {
    fireAt(h, OPENING_AIM);
    const swept = await h.stepUntil((s) => coreCount(s) === 0, {
      maxTicks: FLIGHT_TICKS,
      poll: 1,
    });
    await h.step(SETTLE_TICKS);
    return swept;
  });

  assertEqual(
    granted.hit,
    true,
    `the run of ${MIN_RUN + 1} drawn out within ${FLIGHT_TICKS} ticks of the shot`,
  );
  assertNotNull(
    granted.snapshot.machinery,
    "the active machinery on the tick the run carrying two marks was drawn out",
  );
  assertEqual(
    granted.snapshot.machinery?.kind,
    TAIL_MARK,
    "the kind the mark nearest the tail left active",
  );
  assertNear(
    granted.snapshot.machinery?.remaining ?? Number.NaN,
    MACHINERY_DURATION[TAIL_MARK],
    TICK_TOL * TICK_DT,
    `the seconds left on the ${TAIL_MARK} the tail-most mark granted`,
  );
});
