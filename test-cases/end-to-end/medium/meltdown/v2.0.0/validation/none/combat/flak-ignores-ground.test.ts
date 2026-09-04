// Meltdown — combat/flak-ignores-ground: the Flak refuses a ground unit.
//
// `specs/combat.md`: the Flak "targets flying units alone and ignores every ground
// unit WHATEVER ITS RANGE". `specs/surge.md` gives the Mote `Flies: no`, so a Flak
// with a Mote sitting three tiles away — inside its `8.0` several times over — has
// no target at all, reports `firing` false, and never touches it.
//
// TEN SECONDS, WHICH IS TWENTY-SIX FIRE INTERVALS at the Flak's `2.6` a second.
// The window is long rather than tight because what it has to exclude is not a
// figure but an event: a build that fires on ground units at any rate, however
// slow, removes hp inside it. A single interval would let a build with a broken
// fire clock through on a technicality.
//
// TWO READINGS OF THE SAME REFUSAL. `firing` is false — which `specs/combat.md`
// requires of every frame the emitter has no target — and the Mote's hp is exactly
// what it was. The second is the one that matters: it catches a build that reports
// `firing` false and resolves shots underneath the flag.
//
// THE MARK CANNOT WANDER AND CANNOT DIE. Its motion is off, so it holds the tile
// for the whole ten seconds, and its hp is far past what a shot could remove, so a
// build that DOES fire on it leaves a reading rather than an empty roster.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readGun,
  readHp,
} from "./duel";

/** The emitter read, the heat it is pinned at, and the ground unit it must ignore. */
const TOWER = "flak";
const HEAT = 0;
const MARK = "mote";

/** How long the refusal is held for, in seconds of game time. */
const WATCH_SECONDS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Flak is air-only", async () => {
  const gunId = await poseGun(h, TOWER, HEAT);
  const mark = await poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = await readHp(h, mark);

  await h.skip(WATCH_SECONDS);
  await h.advance(1);
  await captureStill(h, "ground");
  const gun = await readGun(
    h,
    gunId,
    "the Flak with only a ground unit in range",
  );

  assertEqual(
    gun.firing,
    false,
    `firing after ${WATCH_SECONDS}s with a ground ${MARK} the only unit in range`,
  );
  assertEqual(
    opened - (await readHp(h, mark)),
    0,
    `hp a ${TOWER} removed from a ground ${MARK} in range over ` +
      `${WATCH_SECONDS}s, which is ${WATCH_SECONDS * fireRateOf(TOWER)} ` +
      `fire intervals`,
  );
});
