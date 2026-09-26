// instrumentation/rest-pose-and-live-pose-stay-separate — a rest-pose edit made
// during a run does not touch the running part.
//
// THE RULE, the last of the five that hold across the whole machine group: "A
// part's rest pose and its live pose are separate, so `setPartRotation`,
// `setPartLength`, and `movePart` leave `sim.poses` as it stands"
// (`specs/instrumentation.md`, The machine).
//
// WHAT EACH OF THE THREE WRITES is its own row: `setPartRotation` "Sets that
// part's rest rotation", `setPartLength` "Sets that part's rest length", and
// `movePart` "Translates the whole part... so its anchor is `(q, r)`" — all three
// of them entries of `editor.parts`, which the snapshot shape carries as the
// machine "in placement order". `sim.poses` is the other half, "`{ part, rotation,
// length, cell }`", and it is what the simulation moves.
//
// SO THE CHECK READS BOTH HALVES AFTER ONE EDIT OF EACH KIND: the rest pose has
// taken all three edits, and the live pose is untouched. Then it runs the cycle
// the tape carries and reads the live pose again, because a live pose that had
// silently taken the edit would be indistinguishable from one that had not until
// something moved it: `rotate-cw` turns "one 60 degree step clockwise about its
// base" (`specs/instructions.md`), so the running part turns from the live
// rotation it was holding rather than from the rest rotation just written, about
// the live cell rather than the anchor just moved, and its live length is the one
// it had rather than the one just chosen.
//
// THE WORLD IS POSED, NOT SEARCHED. One piston, alone on the field, with the
// completion switch off and every mote cleared: nothing else can move, and the
// only thing that could have changed a pose is the cycle the check ran.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { turnDirection } from "../field";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partById,
  partIds,
  poseOf,
  type Harness,
} from "../harness";
import { BARE, EAST, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes the rest pose and leaves sim.poses standing, so the run carries on from the live pose", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
    ]),
  });
  const [piston] = await partIds(h);
  const part = piston as number;

  const opened = await h.snapshot();
  const live = poseOf(opened, part);
  assertNotNull(live, "the run carries a live pose for the placed piston");
  assertEqual(
    live?.rotation,
    0,
    "the run started the piston at its rest rotation",
  );
  assertEqual(live?.length, 1, "the run started the piston at its rest length");
  assertEqual(
    live?.cell.q,
    ORIGIN.q,
    "the run started the piston on its anchor",
  );
  assertEqual(
    live?.cell.r,
    ORIGIN.r,
    "the run started the piston on its anchor",
  );

  await h.debug.setPartRotation(part, 3);
  await h.debug.setPartLength(part, ARM_MAX_LEN);
  await h.debug.movePart(part, EAST.q, EAST.r);

  const edited = await h.snapshot();
  const rest = partById(edited, part);
  assertNotNull(rest, "the edited piston is still on the machine");
  assertEqual(rest?.rotation, 3, "setPartRotation writes the rest rotation");
  assertEqual(
    rest?.length,
    ARM_MAX_LEN,
    "setPartLength writes the rest length",
  );
  assertEqual(rest?.q, EAST.q, "movePart writes the rest anchor");
  assertEqual(rest?.r, EAST.r, "movePart writes the rest anchor");

  const held = poseOf(edited, part);
  assertNotNull(held, "the run still carries a live pose for the piston");
  assertEqual(
    held?.rotation,
    0,
    "setPartRotation leaves sim.poses as it stands",
  );
  assertEqual(held?.length, 1, "setPartLength leaves sim.poses as it stands");
  assertEqual(held?.cell.q, ORIGIN.q, "movePart leaves sim.poses as it stands");
  assertEqual(held?.cell.r, ORIGIN.r, "movePart leaves sim.poses as it stands");

  await captureReplay(h, "separate", () => advanceCycles(h, 1));

  const ran = await h.snapshot();
  const moved = poseOf(ran, part);
  assertNotNull(moved, "the run still carries a live pose after the cycle");
  assertEqual(
    moved?.rotation,
    turnDirection(0, 1),
    "rotate-cw turned the piston one step clockwise from the live rotation it was holding, not from the rest rotation just written",
  );
  assertEqual(
    moved?.length,
    1,
    "the cycle left the live length the run started with, not the rest length just written",
  );
  assertEqual(
    moved?.cell.q,
    ORIGIN.q,
    "the cycle turned the piston about the live cell, not the anchor just moved",
  );
  assertEqual(moved?.cell.r, ORIGIN.r, "the cycle left the live cell standing");
});
