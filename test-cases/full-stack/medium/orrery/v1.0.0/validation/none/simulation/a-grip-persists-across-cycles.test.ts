// simulation/a-grip-persists-across-cycles — a hold taken once survives every
// cycle until the part drops it.
//
// THE RULE. "Grips persist across cycles until dropped and ride the motion of the
// part that holds them" (`specs/simulation.md`, Motion and carrying). The tape
// says the same of the cycles in between: "A blank cell is a rest: the part holds
// its pose for the cycle, keeping whatever grip it has"
// (`specs/instructions.md`), and only `drop` opens a gripper — "2. Drops. Every
// gripper of every part whose instruction is `drop` opens" — while `grab` is the
// only thing that closes one.
//
// THE CONFIGURATION. An arm on `(0, 0)` at rotation `0`, length `1`, so its one
// gripper stands on `(1, 0)` (`specs/parts.md`), with one mote resting there —
// the whole of the field, so no pair exists for the collision rule and nothing can
// fault. Its tape is ten cells long, which by `specs/instructions.md` makes the
// machine's period `P` ten, so each cell runs once and in order:
//
//   cell 0            `grab`      — the one and only grab
//   cells 1 through 8 rotations   — eight cycles of motion, alternating clockwise
//                                   and counterclockwise so the arm swings between
//                                   `(1, 0)` and `(0, 1)` and never leaves the
//                                   field
//   cell 9            `drop`      — the release
//
// EIGHT MOTION CYCLES WITH NO FURTHER GRAB is the whole of "survives every
// following motion cycle with no further grab, until that part executes `drop`".
//
// THE GRIP IS READ BY THE PART RATHER THAN BY THE SPOKE. `sim.grips` records a
// grip's `spoke` and the arm's live rotation changes every cycle here; no sentence
// of `specs/` fixes what a held gripper's spoke number reads as while the part
// turns, so the check reads every grip the part has and what it holds, which the
// specification does fix.
//
// THE ROTATIONS REALLY RAN, which is what separates this from a build whose parts
// never move: after the first motion cycle the arm's live rotation has taken its
// clockwise step, from `0` to `1` ("Rotating a direction index clockwise adds `1`
// modulo `6`", `specs/field.md`), and the held mote has moved with it to `(0, 1)`
// ("The same rotation about the base", the motion table).
//
// THE VERDICT. After every one of the eight motion cycles the run still reports
// exactly one grip for the arm, holding the same mote. After the ninth — the
// `drop` — it reports none, and the mote is left resting where the last rotation
// put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How many motion cycles run between the one grab and the one drop. */
const MOTION_CYCLES = 8;

/** The tape: one grab, eight alternating rotations, one drop. */
const TAPE = [
  "grab",
  "rotate-cw",
  "rotate-ccw",
  "rotate-cw",
  "rotate-ccw",
  "rotate-cw",
  "rotate-ccw",
  "rotate-cw",
  "rotate-ccw",
  "drop",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps one grab's hold through eight motion cycles and loses it to the drop", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, [...TAPE])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const mote = await spawnMote(h, at(1, 0), "dust");

  const readings = await captureReplay(h, "held", async () => {
    const taken: OrrerySnapshot[] = [];
    for (let cycle = 0; cycle < TAPE.length; cycle += 1) {
      await advanceCycles(h, 1);
      taken.push(await h.snapshot());
    }
    return taken;
  });

  const grabbed = readings[0] as OrrerySnapshot;
  assertLength(
    gripsOf(grabbed, arm),
    1,
    "the one grab on the tape closed the arm's one gripper over the mote on its hex",
  );
  assertEqual(
    gripsOf(grabbed, arm)[0]?.mote,
    mote,
    "the grip the grab took holds the mote the gripper stood over",
  );

  // The first motion cycle really moved the part and its hold.
  const turned = readings[1] as OrrerySnapshot;
  assertNotNull(poseOf(turned, arm), "the run reports the arm's live pose");
  assertEqual(
    poseOf(turned, arm)?.rotation,
    1,
    "rotate-cw turns the part's direction one clockwise step, so the motion cycles really ran",
  );
  assertEqual(
    `${moteById(turned, mote)?.q},${moteById(turned, mote)?.r}`,
    "0,1",
    "the held mote rode the same rotation about the base",
  );

  for (let cycle = 1; cycle <= MOTION_CYCLES; cycle += 1) {
    const reading = readings[cycle] as OrrerySnapshot;
    assertEqual(
      reading.sim?.status,
      "running",
      `one mote alone on the field cannot collide, so cycle ${cycle} reached its boundary`,
    );
    assertLength(
      gripsOf(reading, arm),
      1,
      `the grip persists across cycles until dropped, so it is still reported after motion cycle ${cycle}`,
    );
    assertEqual(
      gripsOf(reading, arm)[0]?.mote,
      mote,
      `the grip still holds the same mote after motion cycle ${cycle}`,
    );
  }

  const dropped = readings[TAPE.length - 1] as OrrerySnapshot;
  assertEqual(
    dropped.sim?.cycle,
    TAPE.length,
    "all ten cells of the tape ran, one per cycle",
  );
  assertLength(
    gripsOf(dropped, arm),
    0,
    "the grip lasts until that part executes drop, and then it is gone",
  );
  assertEqual(
    `${moteById(dropped, mote)?.q},${moteById(dropped, mote)?.r}`,
    "1,0",
    "the released mote rests where the last rotation left it",
  );
});
