// resonance/core-fills — destroying a Prism's exposed core raises the meter by
// `RESONANCE_KILL`.
//
// THE RULE. `specs/resonance.md`, the same sentence that exempts the shell:
// "Breaking a Prism's shell adds nothing; destroying a Prism's exposed core is a
// matching kill and adds `RESONANCE_KILL`." This is the other direction of
// `resonance/shell-fills-nothing`: a build that pays nothing for either layer
// fails here and passes there, and a build that pays for both fails there and
// passes here, so the pair cannot be satisfied by one blanket rule.
//
// THE PRISM IS POSED WITH ITS SHELL ALREADY BROKEN, through `setDroneShell`,
// rather than broken with a first shot. `specs/drones.md` makes the core the
// exposed layer exactly when the shell is gone, and that is the whole
// precondition this point needs; firing a shell-breaking shot first would put a
// second matching contact inside a scenario that is measuring what ONE kill adds.
//
// THE SHOT IS THE CORE'S BAND, WHICH IS THE OPPOSITE OF THE STORED ONE.
// `specs/drones.md`: "The shell's band is the Prism's stored band, and the core's
// is always the opposite", and a shell-broken Prism is "Broken by | A shot whose
// effective band matches the core's". The Prism stores cyan, so the magenta shot
// is the matching one — which also means a build that reads the stored band
// straight through, ignoring the shell swap, destroys nothing here and reads the
// meter unmoved.
//
// WHAT THIS DOES NOT DECIDE. That the core falls to a matching shot at all is
// `bands`' and `drones`'; what the core kill SCORES is `scoring`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  RESONANCE_KILL,
  RESONANCE_MAX,
} from "../../src/constants";
import { assertCloseTo, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander } from "./wave";

/**
 * Where the meter is posed before the kill, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): clear of `0`, so adding and setting read
 * differently, and clear of the ceiling, so `POSED_METER + RESONANCE_KILL` (`24`)
 * is nowhere near the cap.
 */
const POSED_METER = 20;

/**
 * Where the target Prism stands.
 *
 * Mid-field on the ship's own lane, clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`), clear of `SHIP_Y` (`600`), and clear of the corner the
 * bystander holds.
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Geometry, not a tolerance: a shell-broken Prism's contact reach against one of
 * the player's bullets is `PRISM_CORE_HALF` (`13`) + `PLAYER_BULLET_HALF` (`6`) =
 * `19` units of centre separation, so `140` places the bullet seven times clear
 * of it.
 */
const SHOT_BELOW = 140;

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds RESONANCE_KILL when a matching shot destroys a Prism's exposed core", async () => {
  startPosed(h);
  // The Prism is destroyed outright by this scenario, and a stage clears in the
  // moment the last drone of its wave is destroyed (specs/stages.md); the
  // bystander leaves the wave a drone standing, so the meter is read on the live
  // wave rather than under the stage-cleared interstitial.
  poseBystander(h);
  h.debug.setResonance(POSED_METER);
  const prism = poseDrone(h, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: false,
  });

  const posed = h.snapshot();
  assertEqual(
    droneOf(posed, prism).shellAlive,
    false,
    "precondition: the Prism's core is the exposed layer",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the core kill is measured from",
  );

  await fireAt(h, TARGET.x, TARGET.y, "magenta", SHOT_BELOW);
  captureStill(h, "filled");

  const after = h.snapshot();
  assertNull(
    findDrone(after, prism),
    "precondition: the magenta shot destroyed the exposed core of the " +
      "stored-cyan Prism (specs/drones.md)",
  );
  assertCloseTo(
    after.resonance,
    POSED_METER + RESONANCE_KILL,
    METER_DIGITS,
    `the meter after a Prism's exposed core was destroyed: ${POSED_METER} + ` +
      `RESONANCE_KILL (${RESONANCE_KILL}) (specs/resonance.md), out of ` +
      `RESONANCE_MAX (${RESONANCE_MAX})`,
  );
});
