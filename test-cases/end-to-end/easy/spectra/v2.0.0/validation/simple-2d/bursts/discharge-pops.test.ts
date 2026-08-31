// Spectra — bursts/discharge-pops: a discharge pops each drone it destroys.
//
// `specs/assets.md`, the drone-burst's "When" rule: "One burst starts in the
// moment a drone is destroyed, BY A BULLET OR BY A DISCHARGE WAVE ALIKE."
// `specs/resonance.md` fixes what the wave takes: it is band-blind, and "A drone
// in phase `entering`, `diving`, or `returning`" is destroyed by it while "A
// drone in phase `formation`" is not.
//
// THE READING IS ONE BURST PER DRONE THE WAVE TOOK. Three divers, three bursts —
// the count is what separates a build that pops each drone the wave destroys
// from one that pops only the drones a BULLET destroys (nothing) and from one
// that plays a single effect for the whole wave (one). Three rather than one,
// because a build with a burst per wave and a build with a burst per drone are
// indistinguishable when only one drone dies.
//
// WHY THE DIVERS ARE POSED RATHER THAN LAUNCHED. `specs/resonance.md` keys the
// wave's effect on the drone's PHASE and on nothing else, so the requirement is
// reached by posing three drones in phase `diving` — with travel off, so each
// holds the place it was put, and fire off, so none of them puts a bullet on the
// field that the wave would also have to clear. The wave itself is not posed:
// the meter is filled to `RESONANCE_MAX` and the discharge action is driven
// through its own key, so the build's own discharge is what expands and the
// build's own rules are what it destroys.
//
// WHY THE COUNT IS READ A HALF-SECOND IN. The wave is live for `DISCHARGE_TIME`
// (`0.5`) seconds and grows from `0` to `DISCHARGE_MAX_R` (`1500`), and the
// furthest of these drones is under `400` units from the ship, so every one of
// them is taken well inside that half second — while a burst plays for
// `BURST_DURATION` (`0.7`) seconds, so every burst the wave started is still
// playing when the wave ends. The three are counted there, where all three are
// live at once.
//
// WHAT THIS DOES NOT DECIDE. What the wave destroys, and what it spares, is
// `resonance/`'s; it is read here as the precondition of three pops. Where each
// burst stands is `bursts/spawns-on-kill`, and the cap on how many play at once
// is `bursts/capped`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { BINDINGS, DISCHARGE_TIME, RESONANCE_MAX } from "../../src/constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander } from "./scene";

/** The key `specs/controls.md` binds the discharge action to. */
const DISCHARGE_KEY = BINDINGS.discharge[0];

/**
 * Where the three divers stand: a clear stretch of the play field, spread across
 * its width, all of them well inside `DISCHARGE_MAX_R` (`1500`) of the ship so
 * the wave reaches every one of them before its time is up.
 */
const DIVERS_AT = [
  { x: 300, y: 420 },
  { x: 640, y: 420 },
  { x: 980, y: 420 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one burst for each of the three divers the wave destroyed", async () => {
  startPosed(h);
  // In the formation, so the wave spares it and the wave stays open once the
  // three divers are taken (specs/resonance.md, and see poseBystander).
  poseBystander(h);
  for (const at of DIVERS_AT) {
    poseDrone(h, "shard", at.x, at.y, { phase: "diving" });
  }

  const posed = h.snapshot();
  assertLength(
    posed.bursts,
    0,
    "precondition: no burst is playing before the discharge",
  );
  assertLength(
    posed.drones,
    DIVERS_AT.length + 1,
    "precondition: the three divers and the bystander are on the field",
  );

  h.debug.setResonance(RESONANCE_MAX);
  await h.tap(DISCHARGE_KEY);
  await h.advance(ticksFor(DISCHARGE_TIME));

  // The three bursts the wave left behind, all still playing.
  captureStill(h, "pops");

  const after = h.snapshot();
  assertLength(
    after.drones,
    1,
    "precondition: the wave destroyed all three divers and spared the drone " +
      "resting in the formation (specs/resonance.md)",
  );
  assertLength(
    after.bursts,
    DIVERS_AT.length,
    `the bursts playing after a discharge destroyed ${DIVERS_AT.length} ` +
      `divers (specs/assets.md: one burst starts in the moment a drone is ` +
      `destroyed, by a bullet or by a discharge wave alike)`,
  );
});
