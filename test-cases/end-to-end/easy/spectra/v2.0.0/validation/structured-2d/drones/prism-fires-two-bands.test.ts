// drones/prism-fires-two-bands — a Prism's dive puts up one bullet of each band.
//
// specs/drones.md, Its fire: "A diving Prism takes exactly two shots over its dive,
// fired together as it crosses the fire line, one carrying each band, so it
// threatens the ship whichever band the ship is tuned to." That last clause is the
// requirement: the ship's band is also its shield (specs/bands.md), so a two-band
// burst is the one thing on the field a player cannot simply tune out of, and it is
// why a Prism's dive is the moment to dodge rather than to absorb.
//
// WHAT IS DRIVEN. One Prism alone, sixty units above `DIVE_FIRE_Y` (`360`), in
// phase `diving` with travel and fire on and nothing else on the field: no
// formation (`setDiveLaunching` is off through `startPosed`), no second drone to
// contribute a bullet, and the ship's contact test off, so a bullet reaching the
// ship neither ends the run nor leaves the roster early.
//
// WHY THE DIVE IS WATCHED RATHER THAN COUNTED AT ITS END. An enemy bullet falls at
// `ENEMY_BULLET_SPEED` (`320`) and leaves the field about a second after it is
// fired, so the roster at the end of a dive holds only what was fired late in it.
// `watchDive` samples every frame and counts each bullet ONCE, by id, so a build
// that fires its two shots a second apart is still counted as two. What is read is
// each bullet's STORED band, which specs/swarm.md fixes for the bullet's life — and
// which a spectral inversion, should the dive go on to trigger one, does not touch.
//
// WHETHER THE TWO ARE FIRED TOGETHER is not read here, and neither is the band the
// Prism itself stores: this point asserts that the dive produced exactly two
// bullets and that between them they cover both bands.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y, FORM_CENTER_X } from "../../src/constants";
import { assertContains, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { watchDive } from "./dive";

/** The two bands specs/bands.md fixes; there is no third and no neutral value. */
const BANDS: readonly Band[] = ["cyan", "magenta"];

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/** The shots specs/drones.md gives a Prism over a dive. */
const SHOTS = 2;

/**
 * How far above `DIVE_FIRE_Y` the diving Prism starts, in logical units.
 *
 * Sixty units is a fifth of a second at `DIVE_SPEED` (`300`), so the crossing that
 * buys the shots happens early in the dive whatever path the build lays out.
 */
const ABOVE_FIRE_LINE = 60;

/** Where the diving Prism starts: on the ship's lane, above the fire line. */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - ABOVE_FIRE_LINE } as const;

/**
 * Frames the dive is watched for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." The sweep stops
 * itself the moment the drone leaves phase `diving`, and only a diving drone fires,
 * so nothing is missed by stopping there.
 */
const DIVE_FRAMES = ticksFor(8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one cyan and one magenta enemy bullet over a Prism's dive", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one diver the
  // requirement is about.
  startPosed(h);
  const prism = poseDrone(h, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const dive = await watchDive(h, prism, { maxFrames: DIVE_FRAMES });
  captureStill(h, "both");

  assertLength(
    dive.shots,
    SHOTS,
    "the shots a Prism takes over one dive (specs/drones.md)",
  );
  const bands = dive.shots.map((bullet) => bullet.band);
  for (const band of BANDS) {
    assertContains(
      bands,
      band,
      `the band a Prism's dive threatens a ${band}-tuned ship with ` +
        "(specs/drones.md)",
    );
  }
});
