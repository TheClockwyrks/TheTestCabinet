// Meltdown — movers/forge-does-not-fire: the Forge never fires.
//
// specs/towers.md opens on the roster with the two movers that "never fire, carry
// no heat, and have no radiator faces at any rotation", and gives the Forge no
// range, no fire rate, no base damage and no `heatPerShot` — the columns are blank
// for it. So there is no arrangement of the surge in which a Forge acquires a
// target, and specs/combat.md's `firing` — "has a target and is online this frame"
// — is false on every frame of its life, `targeting` is null, and the two tallies
// it keeps never leave zero.
//
// WHAT THE SURGE IS DOING THERE. A mover has no range, so there is no distance that
// would be "in" it and none that would be out. `inert.ts` stands one unit of every
// surge type within four tiles of the Forge — inside the shortest range on the
// emitter roster several times over — so a build that gave its Forge any range at
// all, and any exception for any type, has every one of them in reach. The head of
// that file states the rest of the arrangement.
//
// FIVE READINGS, AND THE LAST IS THE ONE THAT MATTERS. `firing`, `targeting`,
// `kills` and `damageDealt` are what the build REPORTS; the hp the six marks still
// carry is what the build DID. A build that reports the flag correctly and resolves
// shots underneath it passes the first four and fails the fifth.
//
// TEN SECONDS, WHICH IS EIGHT FIRE INTERVALS AT THE SLOWEST RATE ON THE ROSTER —
// the Lance's `0.8` a second — and seventy at the fastest, the Stutter's `7.0`. The
// window is long rather than tight because what it has to exclude is not a figure
// but an event: a build that fires at any rate, however slow, leaves a reading
// inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { watchAmongTheSurge } from "./inert";

/** The mover read. */
const MOVER = "forge";

/** How long the refusal is held for, in seconds of game time. */
const WATCH_SECONDS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge never fires", async () => {
  const watch = await watchAmongTheSurge(h, MOVER, WATCH_SECONDS);
  captureStill(h, "inert");

  assertEqual(
    watch.tower.firing,
    false,
    `the firing a ${MOVER} reports after ${WATCH_SECONDS}s with a unit of ` +
      `every surge type standing round it`,
  );
  assertNull(
    watch.tower.targeting,
    `the unit a ${MOVER} reports targeting after ${WATCH_SECONDS}s among the surge`,
  );
  assertEqual(
    watch.tower.kills,
    0,
    `the kills a ${MOVER} tallied over ${WATCH_SECONDS}s among the surge`,
  );
  assertEqual(
    watch.tower.damageDealt,
    0,
    `the damageDealt a ${MOVER} tallied over ${WATCH_SECONDS}s among the surge`,
  );
  assertEqual(
    watch.hpRemoved,
    0,
    `hp a ${MOVER} removed from the six marks standing round it over ` +
      `${WATCH_SECONDS}s`,
  );
});
