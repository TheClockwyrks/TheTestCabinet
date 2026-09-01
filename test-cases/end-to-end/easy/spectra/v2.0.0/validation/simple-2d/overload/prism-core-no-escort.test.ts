// overload/prism-core-no-escort — an overloaded core bursts and adds nothing.
//
// specs/mode.md closes the Prism's reaction with the other branch: "If the exposed
// layer is the shell, it also adds `OVERLOAD_PRISM_ESCORTS` (`1`) Shard beside it ...
// With only the core left it adds none."
//
// THE POSE IS THE OTHER BRANCH AND NOTHING ELSE. The Prism is posed with its shell
// already gone — `setDroneShell` is the one operation that writes it
// (specs/instrumentation.md) — so the exposed layer is the core, which specs/drones.md
// says reads as the opposite of the stored band. The shot's band is read off
// `effectiveBand` rather than negated from the band the check posed, so it really is
// the mismatch specs/bands.md defines against the layer that is exposed.
//
// THE BURST IS READ TOO, and it is load-bearing rather than a second requirement:
// without it a build that does nothing at all on an overloaded core would pass a check
// that only counted drones. The bullets say the reaction RAN; the roster says it grew
// nothing. `overload/prism-bursts` is the point that grades the burst's own count and
// bands.
//
// THE FIRING FACULTY IS POSED ON for the reason `overload/prism-bursts` gives. Nothing
// else on the field can add a drone: `startPosed` empties the roster and shuts the
// wave's entry gate, so the only drone standing is the Prism itself.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  enemyBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/** Where the target Prism stands. As in `overload/prism-bursts`. */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * More than ten times the 19-unit contact reach a Prism with only its core left has
 * against one of the player's bullets (`PRISM_CORE_HALF` 13 + `PLAYER_BULLET_HALF` 6),
 * so the bullet starts well clear and climbs into it.
 */
const SHOT_BELOW = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no Shard when the burst layer is the core", async () => {
  startPosed(h);
  const target = poseDrone(h, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: false,
    charge: OVERLOAD_AT - 1,
    // Its firing, because the burst this reads as evidence IS a volley.
    fire: true,
  });

  const before = h.snapshot();
  assertEqual(
    droneOf(before, target).shellAlive,
    false,
    "a Prism posed with its outer shell gone, so the exposed layer is the core " +
      "(specs/drones.md)",
  );
  const had = new Set(before.drones.map((drone) => drone.id));

  await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "none");

  assertGreaterThanOrEqual(
    enemyBullets(h.snapshot()).length,
    1,
    "the enemy bullets an overloaded core burst onto the field, which is what " +
      "says the reaction ran at all (specs/mode.md); `overload/prism-bursts` is " +
      "the point that grades their count",
  );
  assertLength(
    h.snapshot().drones.filter((drone) => !had.has(drone.id)),
    0,
    "the drones an overloaded Prism with only its core left adds, which is none " +
      "(specs/mode.md)",
  );
});
