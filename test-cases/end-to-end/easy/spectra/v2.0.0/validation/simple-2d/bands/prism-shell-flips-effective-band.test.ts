// bands/prism-shell-flips-effective-band — a broken shell exposes the opposite band.
//
// specs/bands.md, "Effective band": a stored band is "taken as the opposite band
// once for each of the following that holds", the first being "The entity is a
// Prism whose shell has been broken, so the layer now exposed is its core".
// specs/drones.md says the same in the Prism's own terms — "A Prism wears an
// outer shell of one band around an inner core of the other. The shell's band is
// the Prism's stored band, and the core's is always the opposite", and the shell
// broken leaves the core the exposed layer.
//
// SO THE STORED BAND NEVER MOVES AND THE READING DOES. specs/instrumentation.md
// reports both: `band` is "its STORED band. On a Prism this is the SHELL's; the
// core's is the opposite", and `effectiveBand` is "the band it currently reads
// and counts as". A build that answers this by rewriting the stored band when the
// shell falls is a build whose Prism reads its core's band as the shell's, and
// this failure names it.
//
// THE SHELL IS POSED BROKEN rather than shot off. `setDroneShell(id, false)` is
// the operation specs/instrumentation.md provides for exactly this — "sets
// whether a Prism's outer shell stands" — and what a matching shot does to a
// shell is the `drones` group's point. Posing it is what keeps this reading about
// the definition of effective band.
//
// THE ONE SWAP IS THE SHELL'S. No inversion is posed (`startPosed` leaves it at
// `0`) and a Prism carries no band clock, so exactly one of the three toggles
// holds and `magenta` is the definition applied once. That two of them CANCEL is
// `bands.inversion-cancels-two-swaps`'s point, and it is the composition this
// one cannot reach.
//
// ONE FRAME RUNS, so the reading is taken off a game that has stepped rather than
// off the pose itself, and so the still has a rendered field in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Prism stands: well inside the play field (specs/field.md). */
const PRISM_X = LANE_CENTER;
const PRISM_Y = 320;

/** The band the shell stores, and the core's, which is always the opposite. */
const SHELL_BAND = "cyan" as const;
const CORE_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan Prism whose shell is broken as magenta", async () => {
  startPosed(h);
  const prismId = poseDrone(h, "prism", PRISM_X, PRISM_Y, {
    band: SHELL_BAND,
    shell: false,
  });

  await h.advance(1);
  captureStill(h, "exposed");

  const prism = droneOf(h.snapshot(), prismId);
  assertEqual(
    prism.effectiveBand,
    CORE_BAND,
    `the effective band of a Prism storing ${SHELL_BAND} whose shell has been ` +
      `broken (it stores ${prism.band}, shellAlive ` +
      `${String(prism.shellAlive)}, with no inversion running) — ` +
      "specs/bands.md: a Prism whose shell has been broken reads its stored " +
      "band taken as the opposite, which is the core now exposed",
  );
});
