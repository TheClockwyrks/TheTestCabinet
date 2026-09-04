// Meltdown — surge/dies-at-zero-hp: a unit whose hp runs out leaves the floor on
// that frame.
//
// THE RULE. `specs/surge.md`'s leaving table: a unit "is removed from the floor
// on the frame" "its hp reached `0`". Not a frame later, and not left standing at
// zero until something else sweeps it up.
//
// WHY THE DEATH IS REACHED THROUGH A SHOT. `setUnitHp` "does not kill the unit:
// death belongs to the damage path" (`specs/instrumentation.md`), so a unit posed
// at `0` hp would decide nothing at all — what is under test is the game's own
// removal, and only the damage path reaches it. So one Arc fires on one mark of a
// single hp: the smallest possible target, so the death follows from the shot
// landing at all rather than from any figure `specs/combat.md` gives the shot
// (`surge/roster.ts`).
//
// HOW "ON THAT FRAME" IS READ. Every frame of the drive is sampled, and a
// conformant build can never show the mark at `0` hp or below: the frame that
// takes it there is the frame that removes it, so it is on the roster with hp
// above zero, and then it is not on the roster at all. A build that clamps the hp
// at `0` and sweeps the corpse on the NEXT frame — or on the next wave-clear
// check, or when its animation finishes — shows exactly one such sample, and that
// is the reading this item turns on. A single sample is enough because the
// interval between two of them is one frame, which is the whole quantity in
// question.
//
// TWO THINGS ARE ASSERTED, IN ONE DIRECTION. That the mark left the roster at
// all, and that it was never seen at or below zero hp while it was still on it.
// The first without the second passes a build that leaves corpses standing; the
// second without the first passes a build that never killed anything, since a
// mark that is never hit is never seen at zero either.
//
// THE MARK HOLDS ITS TILE, so it cannot reach an exhaust and leave the roster by
// leaking instead — an entirely different row of the same table, with an entirely
// different cost, which `surge/leak-costs-a-life` decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  requireUnit,
  startRun,
  unitById,
  type Harness,
} from "../harness";
import { FRAGILE_HP, KILL_GUN, KILL_FRAMES, poseGun, poseMark } from "./roster";

/** The type killed: the roster's baseline, since no figure of its row is read. */
const MARK = "mote";

/**
 * How many samples may show the mark at or below zero hp while it is still on the
 * roster: none.
 *
 * There is no tolerance on it and there cannot be one. The specification fixes
 * the removal to the frame the hp reached `0`, the drive samples every frame, and
 * a build that removes on that frame therefore produces zero such samples while a
 * build that removes one frame later produces one.
 */
const ALLOWED_ZERO_HP_SAMPLES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes a unit on the frame its hp reaches 0", async () => {
  await startRun(h);
  await poseGun(h, KILL_GUN);
  const mark = await poseMark(h, MARK, FRAGILE_HP);

  const posed = requireUnit(
    await h.snapshot(),
    mark,
    "the mark before the shot",
  );

  // Every frame until the mark leaves the roster, counting the samples that found
  // it standing with nothing left. The count is taken inside the sweep because a
  // sample is one crossing into the page.
  let standingAtZero = 0;
  const swept = await h.until(
    (snapshot) => {
      const unit = unitById(snapshot, mark);
      if (unit === undefined) return true;
      if (unit.hp <= 0) standingAtZero += 1;
      return false;
    },
    { maxFrames: KILL_FRAMES, poll: 1 },
  );

  await captureStill(h, "death");

  assertEqual(
    posed.hp,
    FRAGILE_HP,
    "precondition: the mark was posed alive, with one hp",
  );
  assertTrue(
    swept.hit,
    `precondition: the ${KILL_GUN}'s shot took the ${MARK} off the roster ` +
      `inside ${KILL_FRAMES} frames`,
  );
  assertEqual(
    standingAtZero,
    ALLOWED_ZERO_HP_SAMPLES,
    `frames on which the ${MARK} was still on the roster with hp at or below ` +
      "0, sampled every frame (specs/surge.md)",
  );
});
