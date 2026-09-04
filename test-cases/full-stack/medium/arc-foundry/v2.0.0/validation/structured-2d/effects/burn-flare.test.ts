// Arc Foundry — effects/burn-flare: a burn landing on a unit flares on that unit.
//
// THE REQUIREMENT, from `specs/assets.md`: the burn is spawned when "a burn is
// applied", it carries "an ember flare on impact and a low flicker while the burn
// ticks", and it is spawned "at the position of the event that raised it: ... the
// slow snap and the burn on the unit carrying them".
//
// THE PRODUCED FILES ARE SERVED TO THE LOADER HERE, by `./produced.ts`: the system
// so it can be played, and the sprites so the unit under the reading looks and
// behaves as it does in a page.
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
// yard (`specs/assets.md`), so those pixels are already moving before any burn
// lands. That is why the reading is a COMPARISON against the same ground under the
// same looping cycle rather than against a still picture: a four-frame loop
// advances a handful of times in a tenth of a second, and a system simulated live
// moves on nearly every frame of it. The band above the unit is left out, because
// `specs/enemies.md` puts each unit's health bar "above it" and a burn removes
// health while it ticks — a bar redrawing is not a flare.
//
// THE BURN IS SMALL AND SHORT ENOUGH THAT THE UNIT LIVES. One point a second for
// four seconds against a Mote, which `specs/enemies.md` scales to ten health on
// wave one at Medium: nothing dies inside the tenth of a second being read, so no
// death burst can stand in for the flare.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  ticks,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { lattice, motion } from "./region";
import { tileCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const AT = tileCenter(26, 17);

/** Over the unit and the ground just around it, clear of the health bar above it. */
const POINTS = lattice(AT, 18, 3).filter((point) => point.y >= AT.y - 8);

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the ground around a unit moving when a burn lands on it", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "mote", AT);
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  const played = await captureReplay(h, "burn", async () => {
    h.debug.setUnitBurn(unit, 1, 4);
    await h.advance(1);
    return motion(h, POINTS, WINDOW);
  });

  assertGreaterThan(
    played,
    still,
    "the ground around a unit to change on more frames after a burn is " +
      "applied to it than before, so a burn flare is played on it " +
      `(specs/assets.md); it changed on ${still} of ${WINDOW} frames before`,
  );
  assertGreaterThanOrEqual(
    played,
    MOVING,
    "the flare to keep moving across the tenth of a second after the burn " +
      "lands, as a live particle system does (specs/assets.md)",
  );
});
