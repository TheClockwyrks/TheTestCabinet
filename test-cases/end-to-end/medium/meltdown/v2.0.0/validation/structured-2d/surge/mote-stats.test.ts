// Meltdown — surge/mote-stats: the Mote's row of the roster.
//
// THE RULE. `specs/surge.md` tabulates six figures against the Mote: HP `40`, Speed `60`, Slowable yes, Flies no, Bounty `3`, Leak `1`.
// Every one of them is a figure this point reads back off the running game.
//
// WHY THIS ROW MATTERS MOST. `specs/surge.md` calls the Mote "the baseline":
// every other row of the table is described against it, so a build that got the
// Mote wrong has almost certainly got the scale of the whole roster wrong. Its
// `40` hp and `60` units a second are also the figures `specs/waves.md`'s opening
// list leans on hardest, since four of the first eight waves are Motes.
//
// WHERE EACH FIGURE IS READ, AND WHY THREE SCENARIOS RATHER THAN ONE. Hp, speed
// and flight are fields a unit reports, so they are read off the snapshot taken on
// the frame the unit entered, with its locomotion held off — the row is what the
// type CARRIES, and a frame of walking would be reading `specs/mazing.md` instead.
// Bounty and leak are not fields at all: `specs/economy.md` pays the bounty "on the
// frame a unit's hp reaches `0`" and `specs/surge.md` charges the leak when the unit
// "reached its assigned exhaust", so each is reached the way the run reaches it and
// read as a difference across the event. The three scenarios open on their own
// `startRun`, so no reading is taken on the residue of the one before it.
//
// WHY THE BUILD PHASE, AND WHY NOTHING ELSE STANDS ON THE FLOOR. A wave clears only
// while the phase is `wave` (`specs/waves.md`), so a kill or a leak driven in a
// build phase cannot also pay a clear bonus into the money this point is reading.
// The floor holds one gun and one mark, or one leaker and nothing at all, so the
// only event that can move the money or the lives is the one this point drove.
//
// AND THE SIXTH COLUMN IS DRIVEN TOO. Slowability is not readable as a field —
// the snapshot reports a unit's LIVE slow, not whether one could ever be applied
// to it — so it is reached the way the game reaches it, a cold Rime firing on a
// mark of this type, and read off the `slowed` flag afterwards. It belongs here
// rather than to `combat/` alone because the column is this type's row: `combat/`
// decides what a slow IS — its ceiling, its fall with heat, how two of them
// resolve — on the one or two types it needs to say that, and every row of the
// table needs its own answer to whether a slow touches it at all.
//
// WHAT THIS DOES NOT DECIDE. How STRONG the slow is, which is `specs/combat.md`'s
// and `combat/rime-slow-ceiling-scales`'s. Per-wave scaling of the hp belongs to
// `surge/hp-scales-with-the-wave`, which is why this reading is taken on wave 1,
// where `hpScale` is exactly `1`.
//
// WHAT EVERY WRONG MODEL READS. A build that gave every type one hp pool reads
// the same number here as it does for the Hulk; one that scaled the Mote for a
// wave it is not on reads a multiple of `40`; one that swapped the Mote's and the
// Sprint's rows reads `24` and `120`; one that pays a flat bounty reads a figure
// that is not `3`; one that charges a flat leak reads lives falling by something
// other than one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import {
  poseGun,
  poseLeaker,
  poseMark,
  poseStill,
  runUntilGone,
  runUntilLeaked,
  slowTouches,
  unitOf,
} from "./scenario";

/** The row `specs/surge.md` tabulates for this type, as the build was handed it. */
const ROW = SURGE_DEFS.mote;

/**
 * Decimal places the hp and the speed are held to: six, so the allowance is
 * `5e-7`.
 *
 * `specs/surge.md` fixes both figures exactly and `specs/waves.md`'s `hpScale(1)`
 * is `1 + 0.62 * 0`, exactly `1`, so a conforming build reports the tabulated
 * integer itself. The allowance exists for floating-point arithmetic — a build
 * that multiplies by a scale factor it computed rather than by a literal — and for
 * nothing else. It is far too small to admit any neighbouring row of the table.
 */
const EXACT_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the Mote's hp, speed, slowability, flight, bounty and leak", async () => {
  // ---- The figures the unit itself reports ---------------------------------
  startRun(h);
  const id = poseStill(h, "mote");
  const posed = h.snapshot();
  await h.advance(1);
  captureStill(h, "mote");

  const unit = unitOf(posed, id);
  assertCloseTo(
    unit.maxHp,
    ROW.hp,
    EXACT_DIGITS,
    "the Mote's maximum hp on wave 1 (specs/surge.md)",
  );
  assertEqual(unit.hp, unit.maxHp, "the Mote's hp on the frame it entered");
  assertCloseTo(
    unit.baseSpeed,
    ROW.speed,
    EXACT_DIGITS,
    "the Mote's base speed, in logical units a second (specs/surge.md)",
  );
  assertCloseTo(
    unit.speed,
    ROW.speed,
    EXACT_DIGITS,
    "the Mote's current speed, carrying no slow (specs/surge.md)",
  );
  assertEqual(
    unit.flying,
    ROW.flies,
    "whether the Mote flies (specs/surge.md)",
  );

  // ---- What killing one pays -----------------------------------------------
  startRun(h);
  poseGun(h);
  poseMark(h, "mote");
  const moneyBefore = h.snapshot().money;
  const died = await runUntilGone(h);
  const moneyAfter = h.snapshot().money;

  assertTrue(died, "precondition: the Arc's shot took the Mote to 0 hp");
  assertEqual(
    moneyAfter - moneyBefore,
    ROW.bounty,
    "the money a killed Mote paid (specs/surge.md, specs/economy.md)",
  );

  // ---- What letting one through costs --------------------------------------
  startRun(h);
  poseLeaker(h, "mote");
  const livesBefore = h.snapshot().lives;
  const leaked = await runUntilLeaked(h);
  const livesAfter = h.snapshot().lives;

  assertTrue(leaked, "precondition: the Mote reached its exhaust and left");
  assertEqual(
    livesBefore - livesAfter,
    ROW.leak,
    "the lives a leaked Mote cost (specs/surge.md)",
  );

  // ---- Whether a slow touches one ------------------------------------------
  const slow = await slowTouches(h, "mote");

  assertTrue(
    slow.struck,
    "precondition: the cold Rime's shot landed on the Mote",
  );
  assertEqual(
    slow.slowed,
    ROW.slowable,
    "whether the Mote carried the slow a cold Rime applied (specs/surge.md, specs/combat.md)",
  );
});
