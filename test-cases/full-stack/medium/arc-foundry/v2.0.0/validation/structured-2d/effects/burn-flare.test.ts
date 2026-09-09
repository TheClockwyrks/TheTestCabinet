// Arc Foundry — effects/burn-flare: a burn landing on a unit flares on that unit.
//
// THE REQUIREMENT, from `specs/assets.md`: the burn is spawned when "a burn is
// applied", it carries "an ember flare on impact and a low flicker while the burn
// ticks", and it is spawned "at the position of the event that raised it: ... the
// slow snap and the burn on the unit carrying them".
//
// THE PRODUCED FILES REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds: the system so it can be
// played, and the sprites so the unit under the reading looks and behaves as it
// does in a page.
//
// THE BURN IS APPLIED DIRECTLY. `specs/instrumentation.md` applies `setUnitBurn`
// "through the rule `specs/enemies.md` fixes for an applied burn", so the event
// this point is about is raised alone: no shot, no projectile, and no impact burst
// on the same frame to be mistaken for the flare. A Rectifier's hit is what
// `audio/burn` drives, because that point is about a cue rather than about which
// system was played where.
//
// WHAT IS READ, AND HOW THE UNIT'S OWN CYCLE AND ITS BAR ARE KEPT OUT OF THE
// ANSWER. A flare on the unit carrying the burn is drawn over the unit, so the
// reading is taken there — and a unit's own idle cycle loops while it is on the
// yard (`specs/assets.md`), at a rate the specification leaves to the build, so
// those pixels are already moving before any burn lands. The control is therefore
// a SECOND UNIT of the same type, parked on the same frame on the same clear
// ground a few tiles along, with nothing applied to it, and the two are read over
// the same frames: their cycles step together, so what the burning unit's ground
// does over and above the other's is what the burn put there. Read one after the
// other instead, the way a before-and-after pair is, the two windows can straddle
// one idle step differently by chance alone, and a build that plays nothing at
// all passes or fails on the phase of its own sprite. The band above each unit is
// left out, because `specs/enemies.md` puts each unit's health bar "above it" and
// a burn removes health while it ticks — a bar redrawing is not a flare.
//
// THE MARGIN IS ONE IDLE STEP. Two cycles at one rate can differ by at most one
// step over the same window whatever their phase, so the burning ground must
// change on more frames than the other by more than one. A system "simulated as it
// plays" (`specs/assets.md`) moves on nearly every frame of a tenth of a second,
// so a flare clears that by the width of the window.
//
// THE BURN IS SMALL AND SHORT ENOUGH THAT THE UNIT LIVES. One point a second for
// four seconds against a Mote, which `specs/enemies.md` scales to ten health on
// wave one at Medium: nothing dies inside the tenth of a second being read, so no
// death burst can stand in for the flare.

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

it("sets the ground around a unit moving when a burn lands on it", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "mote", AT);
  parkUnit(h, "mote", CONTROL_AT);
  await h.advance(1);

  const played = await captureReplay(h, "burn", async () => {
    h.debug.setUnitBurn(unit, 1, 4);
    await h.advance(1);
    const [subject, control] = await motionEach(h, [POINTS, CONTROL], WINDOW);
    return { subject: subject ?? 0, control: control ?? 0 };
  });

  assertGreaterThan(
    played.subject,
    played.control + IDLE_STEP,
    "the ground around a unit to change on more frames after a burn is applied to it " +
      "than the ground around an identical unit left alone, read over the " +
      "same frames, by more than the one idle step their cycles can differ by, " +
      "so a burn flare is played on it (specs/assets.md); the unit left alone " +
      `changed on ${played.control} of ${WINDOW} frames`,
  );
});
