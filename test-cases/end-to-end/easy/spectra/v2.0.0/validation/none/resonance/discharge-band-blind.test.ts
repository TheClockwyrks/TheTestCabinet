// resonance/discharge-band-blind — a discharge destroys divers of both bands
// whatever band the ship holds.
//
// THE RULE. `specs/resonance.md`, in its own sentence: "The wave is band-blind:
// what band the ship holds, and what band a thing carries, change nothing about
// what it takes." Everything else in this game is decided by the two effective
// bands, so a build that reaches for its band comparison here — the one place it
// must not — is the failure this point exists to catch.
//
// TWO BANDS OF DRONE, AND BOTH BANDS OF SHIP, because the sentence names both
// variables. One round alone would already catch a build that takes only the
// drones matching the ship, and one that takes only the drones opposing it — the
// two obvious wrong models — since with the ship on cyan those two builds take
// different halves of the pair. The second round closes the remaining one: a
// build whose discharge only works while the ship holds its starting band. The
// two rounds are the same requirement read twice, not two requirements.
//
// EACH ROUND STARTS FROM `reset`, which `specs/instrumentation.md` says "empties
// the drone, bullet, and burst rosters and the live discharge", so the second
// round is posed on a field with no wave left over from the first and no drone
// that the first round's wave already took.
//
// THE DRONES ARE POSED IN PHASE `diving`, with every faculty off, so each holds
// the place it was put and fires nothing: `specs/resonance.md` keys what the wave
// takes on the phase, and the only thing varying across the four readings is a
// band.
//
// WHAT THIS DOES NOT DECIDE. That the wave destroys divers at all is
// `resonance/discharge-clears-divers`; what a band decides everywhere ELSE in the
// game is `bands`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { BANDS, DISCHARGE_TIME, type Band } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { release } from "./wave";

/**
 * Where the two divers stand, one of each band.
 *
 * Either side of the ship's lane in the open field, 350 and 361 units from the
 * ship at `(640, 600)` — both a small fraction of `DISCHARGE_MAX_R` (1500), so
 * the wave reaches each of them inside its life, and near enough the same
 * distance that neither band is favoured by being closer.
 */
const DIVERS_AT: Readonly<Record<Band, { x: number; y: number }>> = {
  cyan: { x: 340, y: 420 },
  magenta: { x: 980, y: 480 },
};

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (0.5 s) at the harness's 100 Hz clock, over which the wave
 * grows from `0` to `DISCHARGE_MAX_R` (1500): both divers are reached at roughly
 * a quarter of that span.
 */
const WAVE_FRAMES = framesFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("destroys divers of both bands whichever band the ship holds", async () => {
  for (const shipBand of BANDS) {
    // A field with nothing carried over from the round before: no drone, no
    // bullet, no burst, and no live wave (specs/instrumentation.md).
    await h.debug.reset();
    await startPosed(h);
    await h.debug.setShipBand(shipBand);
    // In the formation, which the wave spares, so a drone is still standing when
    // the two divers are taken (specs/stages.md).

    const divers: { band: Band; id: number }[] = [];
    for (const band of BANDS) {
      divers.push({
        band,
        id: await poseDrone(h, "shard", DIVERS_AT[band].x, DIVERS_AT[band].y, {
          band,
          phase: "diving",
        }),
      });
    }

    const posed = await h.snapshot();
    assertEqual(
      posed.ship.band,
      shipBand,
      "precondition: the band the ship was posed on",
    );
    assertLength(
      posed.drones,
      BANDS.length,
      "precondition: one diver of each band is on the field",
    );
    for (const diver of divers) {
      assertEqual(
        droneById(posed, diver.id)?.effectiveBand,
        diver.band,
        `precondition: the ${diver.band} diver reads as ${diver.band}, with ` +
          `no inversion and no shell or shimmer to swap it (specs/bands.md)`,
      );
    }

    await release(h);
    await h.advance(WAVE_FRAMES);
    if (shipBand === BANDS[0]) await captureStill(h, "blind");
    const after = await h.snapshot();

    for (const diver of divers) {
      assertUndefined(
        droneById(after, diver.id),
        `the ${diver.band} diver after a discharge released with the ship on ` +
          `${shipBand}: destroyed, since the wave is band-blind and what band ` +
          `the ship holds and what band a thing carries change nothing about ` +
          `what it takes (specs/resonance.md)`,
      );
    }
  }
});
