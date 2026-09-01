// overload/flux-sprays-count — an overloaded Flux sprays its new band.
//
// specs/mode.md gives the Flux's reaction: "it fires `OVERLOAD_FLUX_SPREAD` (`3`) enemy
// bullets at once, all carrying its NEW band". Two figures, read together because the
// specification states them together: how many, and what they carry.
//
// THE FIELD IS EMPTY OF BULLETS WHEN THE SHOT LANDS. `startPosed` clears both bullet
// rosters and shuts the wave's three gates, and the one bullet this scenario puts in
// flight is the player's, which specs/bands.md consumes on the contact. So the enemy
// bullets counted afterwards are the spray and nothing else: no drone but this one
// stands, and only a diver fires (specs/swarm.md).
//
// "ITS NEW BAND" IS WHAT MAKES THE POSE MATTER. The Flux is posed holding cyan, so its
// new band is magenta and the spray must carry magenta — a build that fires the band
// the Flux was holding reads three cyan bullets and fails here while a build that fires
// nothing reads none. The flip itself is `overload/flux-flips`; this point reads the
// bullets, and it reads them against the band the Flux REPORTS afterwards so the two
// points cannot both be satisfied by one wrong model.
//
// THE FLUX'S FIRING FACULTY IS POSED ON. specs/instrumentation.md gates "the shots it
// takes during a dive" with `setDroneFire`, and this spray is not one — the Flux is
// resting in the formation, where specs/swarm.md has it fire nothing. Posing the
// faculty on is what keeps a build that routes the spray through its ordinary firing
// path from failing a point that is not about the gate. Its travel and its oscillation
// stay off, so the drone holds its place and its window.
//
// WHAT THIS DOES NOT DECIDE. The headings those bullets leave on, which is
// `overload/flux-spray-angle`; how fast an enemy bullet travels, which is
// `swarm/enemy-bullet-speed`.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  fluxHold,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
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

/** The stage `startPosed` opens on, which fixes `fluxHold`. */
const STAGE = 1;

/**
 * Where the target Flux stands.
 *
 * High in the play field on the formation's own centre line, so the fan the reaction
 * fires has the whole field under it and every bullet of it is still in flight when the
 * roster is read.
 */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * Where in its band window the Flux is posed, in seconds.
 *
 * Half of `fluxHold(STAGE)`: inside the held part, so the drone reads as the band it
 * stores and the shot really is a mismatch rather than the shimmer case
 * `overload/shimmer-takes-no-charge` grades.
 */
const POSED_CLOCK = fluxHold(STAGE) / 2;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly seven times the 21-unit contact reach a Flux has against one of the player's
 * bullets (`FLUX_HALF` 15 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Seconds the spray is flown on after the reading, purely so the still shows it.
 *
 * The three bullets leave the muzzle together, so a picture taken in the frame they
 * were fired is one blob. Half a second carries them `ENEMY_BULLET_SPEED` (320) times
 * `bulletSpeedScale(1)` (1) — 160 units — down a field whose bottom is 436 units below
 * the drone, which opens the fan to better than a hundred units across. It runs AFTER
 * every reading is taken and cannot reach a verdict.
 */
const TAIL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly OVERLOAD_FLUX_SPREAD enemy bullets of the Flux's new band on the field", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET.x, TARGET.y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
    charge: OVERLOAD_AT - 1,
    // Its firing, because the reaction being read IS a volley; see the header.
    fire: true,
  });

  assertLength(
    enemyBullets(h.snapshot()),
    0,
    "the enemy bullets on the posed field, which `startPosed` clears, so the ones " +
      "counted afterwards are the spray alone",
  );

  await mismatchShot(h, target, SHOT_BELOW);
  const after = h.snapshot();
  const flux = droneOf(after, target);
  const sprayed = enemyBullets(after);
  // Flown on past the reading, so the still shows the fan rather than three bullets
  // still stacked on the muzzle. Nothing after this line can reach an assertion.
  await h.advanceSeconds(TAIL_SECONDS);
  captureStill(h, "spray");
  assertLength(
    sprayed,
    OVERLOAD_FLUX_SPREAD,
    "the enemy bullets an overloaded Flux puts on the field at once " +
      "(specs/mode.md)",
  );
  for (const [index, bullet] of sprayed.entries()) {
    assertEqual(
      bullet.band,
      flux.band,
      `bullet ${String(index)} of the spray carrying the Flux's NEW band, ` +
        `${flux.band} (specs/mode.md)`,
    );
  }
});
