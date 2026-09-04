// drones/flux-emerges-opposite — a shimmer ends on the other band.
//
// specs/drones.md, Its rhythm: "When the band clock reaches `fluxWindow(stage)`,
// the Flux's stored band flips to the opposite one and the band clock returns to
// `0`, starting the next window." That flip is the whole point of the kind: it is
// what makes a Flux a moving target for the cannon rather than a slower Shard, and
// what makes `fluxCycle(stage)` — two windows — the trip back to the same band.
//
// WHAT IS DRIVEN. One Flux alone, its band clock at `0` and its stored band CYAN,
// with the oscillation gate on and travel and fire off, so the band clock is the
// only thing moving. The sweep runs to the build's own shimmer and then out the far
// side of it, and the band is read there.
//
// WHY CYAN IS THE POSED BAND. `addDrone` creates a drone holding cyan
// (specs/instrumentation.md), so cyan-in means the value this check requires,
// magenta, is one no build can produce by leaving the band alone or by recomputing
// it from a default. A build whose Flux never flips reads cyan here, and so does
// one that resets the band at the window boundary.
//
// This reads the STORED band alone. What a Flux reads AS mid-shimmer — the band it
// is moving toward — is `bands`', and how long each part of the window lasts is
// `drones/flux-cycle-holds`' and `drones/flux-shimmer-duration`'s.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_SHIMMER, FORM_CENTER_X, fluxWindow } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { requireDrone } from "./roster";

/** The stage the scenario is posed at: a band window's length is per stage. */
const STAGE = 1;

/** The band the Flux enters its shimmer holding. */
const POSED_BAND = "cyan" as const;

/** The other of the two bands specs/bands.md fixes; there is no third. */
function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * Frames from the start of the window to the shimmer, before the sweep gives up.
 *
 * A whole window (`fluxWindow(1)` = `2.0` s) plus 20%, so a build that never
 * shimmers still reaches the reading below — where its band, unflipped, fails.
 */
const ENTER_FRAMES = ticksFor(fluxWindow(STAGE) * 1.2);

/**
 * Frames the shimmer's end is swept for.
 *
 * Three times `FLUX_SHIMMER`, so a build whose telegraph runs long is still read on
 * the far side of it rather than mid-shimmer. How long it may run is
 * `drones/flux-shimmer-duration`'s reading, not this one's.
 */
const LEAVE_FRAMES = ticksFor(FLUX_SHIMMER * 3);

/**
 * What a missing drone would mean here, for the sweeps and the reading below.
 *
 * Nothing on this field can destroy the Flux — no bullet is posed and the ship's
 * contact test is off through `startPosed` — so an id that stops resolving is a
 * build that dropped the drone.
 */
const STANDING =
  "the Flux still standing on an empty field, with nothing posed that could " +
  "destroy it (specs/drones.md)";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings a Flux out of its shimmer on the opposite band", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const flux = poseDrone(h, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: 0,
    oscillation: true,
  });

  const settled = await captureReplay(h, "emerged", async () => {
    await h.until(
      (snapshot) => requireDrone(snapshot, flux, STANDING).shimmer,
      {
        maxFrames: ENTER_FRAMES,
        poll: 1,
      },
    );
    return h.until(
      (snapshot) => !requireDrone(snapshot, flux, STANDING).shimmer,
      { maxFrames: LEAVE_FRAMES, poll: 1 },
    );
  });

  assertEqual(
    requireDrone(settled.snapshot, flux, STANDING).band,
    opposite(POSED_BAND),
    `the band a Flux holds after a shimmer, opposite the ${POSED_BAND} it ` +
      "entered with (specs/drones.md)",
  );
});
