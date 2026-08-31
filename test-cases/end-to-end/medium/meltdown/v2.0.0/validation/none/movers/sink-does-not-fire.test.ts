// Meltdown — movers/sink-does-not-fire: The Sink never fires.
//
// `specs/combat.md` takes both movers out of the targeting rule outright — "The
// Forge and the Sink target nothing" — and out of the tally with it: "The Forge
// and the Sink fire nothing, so both report `0` kills and `0` damage dealt
// forever." `specs/towers.md` says the same from the other side: both "never
// fire". And `firing` is reported "on a frame in which it has a target and is
// online" (`specs/combat.md`), so a tower that can never have a target can never
// report it.
//
// THE SCENARIO GIVES THE MOVER EVERY CHANCE. One mark of each of the six surge
// types stands around it — ground and flyer, slowable and immune — every one of
// them inside two and a half tiles of its footprint centre, which is well inside
// the shortest range on the roster. The mover is posed BARE, so its firing
// faculty is on: what is decided here is that a mover never fires, not that a
// gate can silence one.
//
// THE MARKS' HP IS WHAT MAKES THIS MORE THAN A PAIR OF FLAGS. A build could
// report `firing` false and `0` damage dealt while resolving shots underneath
// both, so the reading includes the hp every mark has left. Their motion is off,
// so none walks out of range while the drive runs, and nothing else stands on the
// floor, so the only thing that could take hp off one of them is a shot from this
// tower.
//
// THE DRIVE IS LONG ENOUGH FOR THE SLOWEST GUN ON THE ROSTER. `specs/combat.md`
// lands a first shot one full interval after a target is acquired, and the
// longest interval any emitter has is the Lance's `1 / 0.8` seconds
// (`specs/towers.md`), so two seconds is past the first shot of every rate a
// build could have given a mover by mistake.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { SURGE_TYPES, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import { MARK_HP, poseSurroundedMover } from "./contact";

/** The mover read. */
const MOVER: TowerType = "sink";

/**
 * How long the floor is driven for, in seconds of game time.
 *
 * Past the first shot of the slowest fire rate on the roster: the Lance's `0.8`
 * shots per second is an interval of `1.25` seconds (`specs/towers.md`,
 * `specs/combat.md`).
 */
const WATCH_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Sink never fires", async () => {
  await startRun(h);
  const posed = await poseSurroundedMover(h, MOVER);

  await h.advance(framesFor(WATCH_SECONDS));
  await captureStill(h, "inert");
  const settled = await h.snapshot();
  const mover = requireTower(settled, posed.id, `the ${MOVER} under the surge`);

  assertEqual(
    mover.firing,
    false,
    `firing after ${WATCH_SECONDS}s with a mark of every surge type beside it`,
  );
  assertNull(
    mover.targeting,
    `targeting after ${WATCH_SECONDS}s with a mark of every surge type ` +
      `beside it`,
  );
  assertEqual(
    mover.kills,
    0,
    `kills after ${WATCH_SECONDS}s beside six marks it cannot fire on`,
  );
  assertEqual(
    mover.damageDealt,
    0,
    `damageDealt after ${WATCH_SECONDS}s beside six marks it cannot fire on`,
  );
  for (const [index, id] of posed.marks.entries()) {
    assertEqual(
      requireUnit(settled, id, `the ${SURGE_TYPES[index]} mark`).hp,
      MARK_HP,
      `the hp the ${SURGE_TYPES[index]} mark still carries after ` +
        `${WATCH_SECONDS}s beside a ${MOVER}`,
    );
  }
});
