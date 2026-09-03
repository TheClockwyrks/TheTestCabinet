// simulation/envelope-bounds-nothing-at-run-time — the build envelope bounds where
// a crane may be built and nothing else.
//
// specs/world.md, "The envelope": "Every lattice node used by the structure lies
// inside the envelope, so the envelope bounds where the crane may be built. ... The
// envelope bounds nothing at run time: once the tape runs, the arm swings wherever
// its geometry takes it, envelope or not." specs/statics.md's closed vocabulary of
// failure causes carries nothing for an envelope either, and specs/program.md's
// axis table makes `slew` "unbounded".
//
// The crane is the reference design for the first site, stood up on the third — a
// site whose envelope runs only from `z = -8` to `z = 8`, while the crane's track
// reaches nine units out from the slew axis along `+x`. The yard is emptied first,
// so the site's own wall is not in the way and nothing but the envelope is under
// test. The trolley is posed to the track's far end, which puts the pivot on the
// outermost node of the arm, and the tape then slews half a turn.
//
// Around a quarter turn that node stands past `z = 8`: outside the envelope the
// crane was built in. Two things must hold there — the run is still running with no
// cause, and the slew keeps going to the target the tape gave it rather than
// stopping at any envelope wall. Between them they say the envelope neither ends
// the run nor clamps the motion; a build that clamped would never carry the pivot
// out at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear, assertTrue } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  DESIGNS,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site the crane is stood on: its envelope is the narrowest in `z`. */
const SITE = 2;

/** The track's far end, and the lattice node the trolley stands on there. */
const TROLLEY = 10;
const NODE = { x: 10, y: 4, z: 0 };

/** Where the tape slews to, and the angle the reading is taken past. */
const TARGET = 180;
const PAST = 90;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }] },
  { kind: "move", commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets the arm swing outside the envelope without clamping it or ending the run", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGNS[0]!);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const envelope = started.site.envelope;

  // Put the trolley on the arm's outermost node, and the bob straight back under
  // where that leaves the pivot so the pendulum takes no jolt from the jump.
  await h.debug.setAxis("trolley", TROLLEY);
  await h.debug.setBob(NODE.x, NODE.y - HOIST_START, NODE.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const swung = await runUntil(
    h,
    (s) => s.run.axes.slew.value >= PAST,
    1200,
    "the arm to swing a quarter turn",
  );
  assertNear(
    swung.run.axes.trolley.value,
    TROLLEY,
    1e-9,
    "the trolley standing at the track's far end, so the pivot is the arm's " +
      "outermost node",
  );
  assertGreaterThan(
    swung.run.pivot.z,
    envelope.max.z,
    "the arm's outermost node standing past the envelope's own z bound of " +
      envelope.max.z + " once the arm has turned a quarter of the way round " +
      "(specs/world.md: the envelope bounds nothing at run time)",
  );
  assertEqual(
    swung.run.phase,
    "running",
    "the run still running with the arm outside the envelope",
  );
  assertEqual(
    swung.run.cause,
    null,
    "the cause a run carries while the arm stands outside the envelope",
  );

  // And the motion was never clamped: the slew reaches the target the tape gave.
  const arrived = await runUntil(
    h,
    (s) =>
      s.run.axes.slew.rate === 0 && Math.abs(s.run.axes.slew.value - TARGET) <= 1e-9,
    1200,
    "the slew to reach the target its tape gave it",
  );
  assertTrue(
    arrived.run.phase === "running" || arrived.run.phase === "cleared",
    "the run reaching the end of its slew rather than failing on the way " +
      "(phase " + arrived.run.phase + ", cause " + String(arrived.run.cause) + ")",
  );

  await h.capture(
    "swung-out",
    "The arm standing outside the site's build envelope, mid-run",
  );
});
