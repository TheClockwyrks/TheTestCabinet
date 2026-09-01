// drones/shard-band-fixed — a Shard holds one band for its whole life.
//
// specs/drones.md, The Shard: "Its band is set when it is created and never
// changes on its own for the rest of its life." The Flux is the kind that
// alternates and the Shard is the kind that does not, so this is the half of the
// polarity system a player can plan around.
//
// WHAT IS DRIVEN, AND WHY THE WHOLE SPAN IS READ RATHER THAN ITS END. A Shard is
// posed alone on the field with its OSCILLATION GATE ON — the one faculty that
// moves a band clock (specs/instrumentation.md) — and the field is run for a full
// `fluxCycle(1)`, the span in which a Flux would leave its band and come back.
// Reading only the value at the END of that span would grade nothing: a build that
// oscillates its Shards on the Flux's own rhythm flips twice over a full cycle and
// lands back on the band it started with. So the sweep stops at the FIRST sample
// whose stored band is not the posed one, and the reading is taken there, which
// names the drift rather than averaging it away.
//
// The posed band is magenta, which is not the band `addDrone` gives a fresh drone
// (specs/instrumentation.md gives it cyan). A build that recomputes a Shard's band
// from a default therefore reads cyan here rather than passing by coincidence.
//
// Only the band is read. Where the drone stands is `field`'s, and what its
// `shimmer` field reports is `instrumentation`'s; travel and fire stay off, so
// this drone does nothing but hold its band.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_SHIMMER, FORM_CENTER_X, fluxCycle } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { requireDrone } from "./roster";

/** The stage the scenario is posed at: `fluxCycle` is stated per stage. */
const STAGE = 1;

/** The band the Shard is created holding. */
const POSED_BAND = "magenta" as const;

/**
 * Where the Shard stands.
 *
 * Mid-field on the ship's own lane, clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`) and of `SHIP_Y` (`600`). Nothing here reads a position;
 * this is simply somewhere inside the play field.
 */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How long the band is watched, in frames of the suite's 100 Hz clock.
 *
 * `fluxCycle(1)` — `2 * (fluxHold(1) + FLUX_SHIMMER)` = `4.0` s — is the span the
 * manifest names, and it is the span in which the OTHER oscillating kind completes
 * a whole round trip. A Shard that changes band at all inside a Flux's whole cycle
 * has changed it on its own.
 */
const WATCH_FRAMES = ticksFor(fluxCycle(STAGE));

/**
 * Frames between two readings of the band.
 *
 * `FLUX_SHIMMER` (`0.4` s) is the shortest part of a band window, so a drone that
 * borrowed the Flux's rhythm would hold each value for at least that long; an
 * eighth of it is eight times finer than the shortest thing there is to see.
 */
const POLL = ticksFor(FLUX_SHIMMER / 8);

/**
 * What a missing drone would mean here, for the reading below.
 *
 * Nothing on this field can destroy the Shard — no bullet is posed, the ship's
 * contact test is off through `startPosed`, and the drone neither travels nor
 * fires — so an id that stops resolving is a build that dropped the drone, and
 * the point is named for that rather than for a field read off nothing.
 */
const STANDING =
  "the Shard still standing on an empty field, with nothing posed that could " +
  "destroy it (specs/drones.md)";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a Shard's stored band untouched through a whole Flux cycle", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const shard = poseDrone(h, "shard", AT.x, AT.y, {
    band: POSED_BAND,
    // The gate a band clock runs behind, deliberately ON: the claim is that a
    // Shard holds its band even where a Flux would be moving.
    oscillation: true,
  });

  const drift = await h.until(
    (snapshot) => requireDrone(snapshot, shard, STANDING).band !== POSED_BAND,
    { maxFrames: WATCH_FRAMES, poll: POLL },
  );
  captureStill(h, "fixed");

  assertEqual(
    requireDrone(drift.snapshot, shard, STANDING).band,
    POSED_BAND,
    `the band a Shard was created with, unchanged over the ` +
      `${String(fluxCycle(STAGE))} s of a whole Flux cycle (specs/drones.md)`,
  );
});
