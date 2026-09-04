// waves/building-allowed-during-a-wave — the floor can be built on while a wave
// is being fought.
//
// `specs/waves.md`, The three phases: "Placing, upgrading, and selling are allowed
// in all three." `specs/building.md` fixes what a placement then does, and the
// six conditions its check applies — none of which is a phase.
//
// SO THE ONE THING THIS POINT ADDS TO THE `building` GROUP IS THE PHASE. Every
// other placement in the project is committed from a build phase, which is where
// a player usually builds; a build that gates its shop, its preview or its commit
// on `phase === "building"` passes all of them and fails here, and that is the
// whole reason this item sits in the run group rather than with the others.
//
// BOTH HALVES OF "PLACES SUCCESSFULLY" ARE READ, because a build can refuse a
// mid-wave placement in either of two places: the placement CHECK can call the
// footprint invalid, or the commit can decline a preview it called valid. So the
// preview's `valid` is read first — `specs/instrumentation.md` says "there is no
// operation that asks whether a footprint could be placed. `build.valid` answers
// that through the same check" — and then the tower that landed.
//
// THE FOOTPRINT IS ON A QUIET ANCHOR from `fixtures.ts`, clear of every opening
// and of both corridors, and the purse is far past the Stutter's cost, so the
// placement is valid on all six of `specs/building.md`'s conditions and the phase
// is the only thing that could refuse it.
//
// THE WAVE PHASE IS POSED EMPTY. `wavePending` is `0` and no unit stands on the
// floor, which `specs/waves.md` makes safe — "A phase that has released no unit
// never clears" — so the phase cannot end underneath the placement and turn this
// into a reading taken in a build phase after all.
//
// WHAT EVERY WRONG MODEL READS. A build that refuses the footprint mid-wave reads
// `valid` false and no tower; one that shows a valid preview and declines the
// commit reads `valid` true and no tower; one that disarms the shop during a wave
// holds no preview at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TOWER_DEFS } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
} from "../harness";

/** The type placed, and the quiet anchor its footprint is laid on. */
const TYPE = "stutter";
const AT = FREE_SITE;

/** Enough money that affordability is never what refuses the placement. */
const PURSE = TOWER_DEFS[TYPE].cost * 10;

/** The wave being fought while the tower goes down. */
const WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("commits a placement while the phase is wave", async () => {
  await startRun(h);
  await h.debug.setWave(WAVE);
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(0);
  await h.debug.setMoney(PURSE);

  await h.debug.setArmed(TYPE);
  await h.debug.setPreview(AT.col, AT.row);
  const held = await h.snapshot();
  await h.debug.place();
  await h.advance(1);
  const built = await h.snapshot();

  await captureStill(h, "built");

  assertEqual(
    held.phase,
    "wave",
    `precondition: the run was fighting Wave ${WAVE} when the footprint was held`,
  );
  assertTrue(
    held.build?.valid === true,
    `the placement check's verdict on a ${TYPE} at (${AT.col}, ${AT.row}) mid-wave`,
  );
  assertEqual(
    built.towers.length,
    held.towers.length + 1,
    "the towers on the floor after committing a valid footprint mid-wave",
  );
  assertEqual(
    lastTower(built)?.type,
    TYPE,
    "the type of the tower the mid-wave placement built",
  );
  assertEqual(
    lastTower(built)?.col,
    AT.col,
    "the footprint column the mid-wave placement built on",
  );
  assertEqual(
    lastTower(built)?.row,
    AT.row,
    "the footprint row the mid-wave placement built on",
  );
});
