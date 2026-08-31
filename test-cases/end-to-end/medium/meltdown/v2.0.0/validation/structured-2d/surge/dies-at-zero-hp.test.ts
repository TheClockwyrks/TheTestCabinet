// Meltdown — surge/dies-at-zero-hp: a unit at 0 hp is gone that frame.
//
// THE RULE. `specs/surge.md` removes a unit "on the frame" either of two things
// happens, the first being "Its hp reached `0`", and `specs/combat.md` states the
// same rule as arithmetic: "A unit's hp never falls below `0`, and a unit at `0`
// hp is removed on that frame." So the requirement is not merely that a unit dies
// eventually — it is that the roster NEVER HOLDS a unit whose hp has reached zero.
// That is the invariant this point watches, frame by frame.
//
// WHY THE FLOOR IS DRIVEN RATHER THAN POSED. Death cannot be posed: `setUnitHp`
// "does not kill the unit: death belongs to the damage path"
// (`specs/instrumentation.md`), so the only way to a zero-hp unit is a shot. One
// Arc stands beside one mark of a single hit point, which is the least arrangement
// that reaches the event — `specs/combat.md` scales a shot to
// `baseDamage * heatMultiplier(H, redline)`, and at the level-I Arc's `6` and heat
// `0`'s `0.35` that is `2.1`, which clears one hit point whatever else about the
// gun is wrong. The gun's heat is pinned so no trip can interrupt the drive.
//
// WHY THE MARK HOLDS ITS TILE. `specs/surge.md` gives a unit two ways off the
// floor and this point is about one of them, so the other is closed: with motion
// off the mark cannot reach an exhaust, and a removal read here is a removal for
// hp and for nothing else.
//
// WHY EVERY FRAME IS SAMPLED. "On that frame" is a claim about a single frame, and
// a sweep that looked once a tenth of a second could not tell a build that removes
// the unit on the killing frame from one that leaves a `0`-hp corpse standing for
// six frames and tidies it up afterwards. The drive therefore advances one frame
// at a time and reads the roster after each, so a corpse that survives even one
// frame is caught and named.
//
// WHAT EVERY WRONG MODEL READS. A build that clamps hp at `0` and leaves the unit
// on the roster fails on the corpse; one that lets hp go negative fails on the
// same reading with a negative number; one that removes the unit a frame late
// fails on the one frame it lingered; one whose shot never lands fails the
// precondition, which says so rather than passing quietly.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  unitById,
  type Harness,
} from "../harness";
import { KILL_TICKS, poseGun, poseMark } from "./scenario";

/**
 * The hp at which a unit must already be gone: `0`.
 *
 * There is no tolerance on it and there cannot be one. The rule is a threshold
 * crossing, not a quantity, so the reading is "was a unit with hp at or below this
 * ever on the roster" and the answer must be no.
 */
const DEAD_HP = 0;

/** Frames between two readings: every one, because the claim is about one frame. */
const POLL_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never leaves a unit whose hp reached 0 on the roster", async () => {
  startRun(h);
  poseGun(h);
  const mark = poseMark(h, "mote");

  /** The worst corpse the drive saw: a unit at or under 0 hp still on the floor. */
  let corpse: number | null = null;

  const swept = await h.until(
    (snapshot) => {
      const seen = unitById(snapshot, mark);
      if (seen === undefined) return true;
      if (seen.hp <= DEAD_HP && (corpse === null || seen.hp < corpse)) {
        corpse = seen.hp;
      }
      return false;
    },
    { maxFrames: KILL_TICKS, poll: POLL_FRAMES },
  );

  captureStill(h, "death");

  assertTrue(
    swept.hit,
    "precondition: the Arc's shot took the one-hp Mote off the floor",
  );
  assertNull(
    corpse,
    "the hp of a unit found still on the roster at 0 or below, over every " +
      "frame of the drive; a unit at 0 hp is removed on that frame " +
      "(specs/surge.md, specs/combat.md)",
  );
});
