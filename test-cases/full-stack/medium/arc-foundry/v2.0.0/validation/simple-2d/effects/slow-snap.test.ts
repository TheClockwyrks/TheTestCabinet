// Arc Foundry — effects/slow-snap: a slow landing on a unit snaps on that unit.
//
// THE REQUIREMENT, from `specs/assets.md`: the slow snap is spawned when "a slow
// is applied", it carries "a drag snap clinging to the slowed unit", and it is
// spawned "at the position of the event that raised it: ... the slow snap and the
// burn on the unit carrying them".
//
// THE PRODUCED FILES REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds: the system so it can be
// played, and the sprites so the unit under the reading looks and behaves as it
// does in a page.
//
// THE SLOW IS APPLIED DIRECTLY, AND THAT IS THE POINT. `specs/instrumentation.md`
// applies `setUnitSlow` "through the rule `specs/enemies.md` fixes for an applied
// slow", and a pose "arranges the yard through the same systems play uses". So the
// event this point is about is raised with nothing else raised beside it: no shot
// is fired, no projectile connects, and no impact burst plays on the same frame to
// be mistaken for the snap. A Choke's hit is what `audio/slow` drives, because
// that point is about a cue rather than about which system was played where.
//
// WHAT IS READ, AND HOW THE UNIT'S OWN CYCLE IS KEPT OUT OF THE ANSWER. A snap
// "clinging to the slowed unit" is drawn over the unit, so the reading has to be
// taken there — and a unit's own idle cycle loops while it is on the yard
// (`specs/assets.md`), at a rate the specification leaves to the build, so those
// pixels are already moving before any slow lands. The control is therefore a
// SECOND UNIT of the same type, parked on the same frame on the same clear ground
// a few tiles along, with nothing applied to it, and the two are read over the
// same frames: their cycles step together, so what the slowed unit's ground does
// over and above the other's is what the slow put there. Read one after the
// other instead, the way a before-and-after pair is, the two windows can straddle
// one idle step differently by chance alone, and a build that plays nothing at
// all passes or fails on the phase of its own sprite. The band above each unit is
// left out, because `specs/enemies.md` draws a health bar on every unit and a bar
// is not a snap.
//
// THE MARGIN IS ONE IDLE STEP. Two cycles at one rate can differ by at most one
// step over the same window whatever their phase, so the slowed ground must change
// on more frames than the other by more than one. A system "simulated as it plays"
// (`specs/assets.md`) moves on nearly every frame of a tenth of a second, so a
// snap clears that by the width of the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  ticks,
} from "../harness";
import { lattice, motionEach } from "./region";
import { type Point, tileCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const AT = tileCenter(26, 17);

/** The control unit's ground: the same clear row, six tiles along. */
const CONTROL_AT = tileCenter(20, 17);

/** Over a unit and the ground just around it, clear of the health bar above it. */
function around(center: Point): Point[] {
  return lattice(center, 18, 3).filter((point) => point.y >= center.y - 8);
}

const POINTS = around(AT);
const CONTROL = around(CONTROL_AT);

const WINDOW = ticks(0.1);

/** The most two idle cycles at one rate can differ by over one window. */
const IDLE_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the ground around a unit moving when a slow lands on it", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "mote", AT);
  parkUnit(h, "mote", CONTROL_AT);
  await h.advance(1);

  const played = await captureReplay(h, "slow", async () => {
    h.debug.setUnitSlow(unit, 0.3, 4);
    await h.advance(1);
    const [subject, control] = await motionEach(h, [POINTS, CONTROL], WINDOW);
    return { subject: subject ?? 0, control: control ?? 0 };
  });

  assertGreaterThan(
    played.subject,
    played.control + IDLE_STEP,
    "the ground around a unit to change on more frames after a slow is applied to it " +
      "than the ground around an identical unit left alone, read over the " +
      "same frames, by more than the one idle step their cycles can differ by, " +
      "so a slow snap is played on it (specs/assets.md); the unit left alone " +
      `changed on ${played.control} of ${WINDOW} frames`,
  );
});
