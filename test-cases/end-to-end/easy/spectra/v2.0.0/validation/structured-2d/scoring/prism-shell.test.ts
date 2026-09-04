// scoring/prism-shell — a Prism's shell pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Prism's shell, in any phase" pays
// `SCORE_PRISM_SHELL` (`100`). specs/drones.md fixes what breaking the shell is:
// a Prism wears "an outer shell of one band around an inner core of the other",
// the shell is the exposed layer while it stands, it falls to a single matching
// shot, and "Breaking the shell leaves the Prism alive with its core exposed". So
// this point reads the score after ONE layer fell, with the Prism still standing.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `100` tells four models apart: a
// build that pays the shell nothing reads `0`; one that pays the core's figure
// for whatever layer it hit reads `400`; one that destroys the whole Prism on the
// first matching shot reads `500` (and leaves no Prism, which the assertion below
// catches by name); and a build that pays the shell figure reads `100`. The
// failure therefore names which model the build implemented.
//
// THE PRISM IS POSED WITH ITS SHELL INTACT AND NOTHING ELSE MOVING. `poseDrone`
// leaves every faculty off, so the Prism holds its centre and its phase while the
// bullet climbs, and the shot carries the shell's own band — the plain matching
// case specs/bands.md states. A Prism "can be broken while it rests in the
// formation, not only while it dives" (specs/drones.md), and the figure is paid
// "in any phase", so the resting phase is the quietest place to read it.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`. This shot leaves the
// Prism alive, so the wave still holds a drone either way — but the bystander
// costs nothing and keeps this check posed like its neighbours, whose kills do
// empty the field.
//
// WHAT THIS DOES NOT DECIDE. That a shot of the shell's band breaks the shell is
// `bands`'s and `drones`'s, and it is read here as the precondition of a payment.
// What the exposed CORE pays is `scoring.prism-core`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_PRISM_SHELL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander, requireDrone, shootDrone } from "./scene";

/**
 * Where the Prism is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`), and well
 * clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/**
 * The shell's stored band, which is also the band the shot carries.
 *
 * A cyan shell means a magenta core, since specs/drones.md makes the core's band
 * always the opposite of the shell's.
 */
const SHELL_BAND = "cyan" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_PRISM_SHELL when a Prism's shell is broken", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "prism", TARGET_AT.x, TARGET_AT.y, {
    band: SHELL_BAND,
    shell: true,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Prism the shot strikes, as posed")
      .shellAlive,
    true,
    "precondition: the Prism's shell stands before the shot",
  );

  await shootDrone(h, target, SHELL_BAND);

  // The score the broken shell paid, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  const struck = requireDrone(
    after,
    target,
    "the Prism the shot struck, still standing; breaking the shell leaves the " +
      "Prism alive with its core exposed (specs/drones.md)",
  );
  assertEqual(
    struck.shellAlive,
    false,
    "precondition: the cyan shot broke the cyan shell (specs/drones.md)",
  );
  assertEqual(
    after.score,
    SCORE_PRISM_SHELL,
    `the score after a Prism's shell was broken (specs/scoring.md: a Prism's ` +
      `shell, in any phase, pays SCORE_PRISM_SHELL, ${SCORE_PRISM_SHELL})`,
  );
});
