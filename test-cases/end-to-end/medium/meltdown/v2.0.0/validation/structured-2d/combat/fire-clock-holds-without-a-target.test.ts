// combat/fire-clock-holds-without-a-target — the fire clock waits for a target.
//
// specs/combat.md, The fire clock: on a frame in which an emitter has no target
// its accumulator NEITHER GROWS NOR FALLS, so "an emitter that has sat without a
// target lands its first shot one full interval after the target arrives".
//
// This is the direction `fires-at-its-rate` cannot see. A build that lets the
// accumulator run while the floor is empty fires its first shot on the frame the
// target appears — the accumulator is twenty intervals over by then — and still
// fires at two shots a second afterwards, so only a tower left idle FIRST tells
// the two apart. Ten seconds of idling is twenty of the Arc's intervals, which
// is far more than the one a wrongly-running clock would need to bank.
//
// The tower is pinned at a heat that cannot drift, so the shot the reading looks
// for removes a fixed figure, and the target carries far more hp than one shot
// takes.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, type EmitterDef } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  ticksFor,
  unitById,
  type Harness,
} from "../harness";

const ARC = TOWER_DEFS.arc as EmitterDef;

/**
 * A quiet footprint anchor: clear of the left corridor (rows 16..19) and of the
 * top one (columns 22..29) (specs/floor.md).
 */
const SITE = { col: 4, row: 4 };

/** Four tiles below the anchor: 3.5 tiles out, inside the Arc's 6.0-tile radius. */
const TARGET_TILE = { col: 4, row: 8 };

/** The heat the tower is pinned at, so nothing about its damage can drift. */
const PINNED_HEAT = 0;

/** specs/towers.md: the Arc fires 2.0 shots a second at level I. */
const INTERVAL = 1 / ARC.fireRate;

/** How long the tower is left with nothing to shoot at: twenty intervals. */
const IDLE_SECONDS = 10;

/** The frame the first shot is due on, counted from the target's arrival. */
const FIRST_SHOT_TICKS = ticksFor(INTERVAL);

/**
 * How far that frame may sit from the interval: ONE frame, for the same reason
 * `fires-at-its-rate` allows one — whether the sixtieth delta carries the
 * accumulator to exactly half a second is a property of the addition. A build
 * whose clock ran while it was idle fires on the FIRST frame, fifty-nine out.
 */
const TICK_SLACK = 1;

/** More hp than a shot removes, so the reading is a subtraction, not a death. */
const TARGET_HP = 10_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("still waits a full interval for its first shot after ten idle seconds", async () => {
  startRun(harness);
  posePinnedTower(harness, "arc", SITE.col, SITE.row, PINNED_HEAT);
  await harness.advance(ticksFor(IDLE_SECONDS));

  const target = poseTarget(
    harness,
    "mote",
    TARGET_TILE.col,
    TARGET_TILE.row,
    TARGET_HP,
  );
  const first = await harness.until(
    (snapshot) => (unitById(snapshot, target)?.hp ?? 0) < TARGET_HP,
    { maxFrames: ticksFor(2 * INTERVAL) },
  );
  captureStill(harness, "waiting");

  assertEqual(first.hit, true, "a first shot within two of the Arc's intervals");
  assertBetween(
    first.frames,
    FIRST_SHOT_TICKS - TICK_SLACK,
    FIRST_SHOT_TICKS + TICK_SLACK,
    `the frame the first shot landed on after ${IDLE_SECONDS}s idle`,
  );
});
