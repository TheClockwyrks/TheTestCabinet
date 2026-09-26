// Arc Foundry — effects/impact-burst: a shot that connects bursts where it landed.
//
// THE REQUIREMENT, from `specs/assets.md`: the impact system is spawned when "any
// shot connects with a unit", it carries "a small burst of sparks at the point of
// impact", and it is spawned "at the position of the event that raised it: ... the
// impact where a shot connects".
//
// THE PRODUCED FILES REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds: the system so it can be
// played, and the sprites so the unit under the reading looks and behaves as it
// does in a page.
//
// THE WORLD. One Scrap Capacitor, one held Mote inside its stated range, and one
// more held Mote well outside it, and nothing else. `specs/components.md` puts the
// hit on the projectile — "when the projectile comes within `PROJECTILE_HIT_R`
// (`6`) of that position it applies its damage" — so the frame the unit's health
// drops is the frame the shot connected, and that is the frame the reading starts
// on. The projectile is removed by then, so nothing of the shot itself is left in
// the picture.
//
// A MOTE SURVIVES THE HIT, ON PURPOSE. `specs/components.md` gives a Scrap
// Capacitor `6` damage and `specs/enemies.md` scales a Mote to ten health on wave
// one at Medium, so the unit lives and no death burst can stand in for the impact.
//
// WHAT IS READ, AND HOW THE UNIT'S OWN CYCLE IS KEPT OUT OF THE ANSWER. The burst
// is drawn where the shot landed, which is on the unit, so the reading is taken
// there — and a unit's idle cycle loops while it is on the yard (`specs/assets.md`)
// at a rate the specification leaves to the build, so those pixels are already
// moving before any shot lands. The control is therefore the SECOND MOTE: the same
// type, parked on the same frame on the same clear row, outside the Capacitor's
// range of `100` so nothing is ever fired at it, read over the same frames as the
// struck one. Their cycles step together, so what the struck unit's ground does
// over and above the other's is what the shot put there. Read one after the other
// instead, the way a before-and-after pair is, the two windows can straddle one
// idle step differently by chance alone, and a build that plays nothing at all
// passes or fails on the phase of its own sprite. The band above each unit is left
// out, because a health bar dropping is not a burst.
//
// THE MARGIN IS ONE IDLE STEP. Two cycles at one rate can differ by at most one
// step over the same window whatever their phase, so the struck ground must change
// on more frames than the other by more than one. A system "simulated as it plays"
// (`specs/assets.md`) moves on nearly every frame of a tenth of a second, so a
// burst clears that by the width of the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  unitById,
} from "../harness";
import { lattice, motionEach } from "./region";
import { type Point, structureCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Capacitor's stated range of `100`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** The control unit: the other side of the head, well outside that range. */
const CONTROL_AT = { x: HEAD.x - 220, y: HEAD.y };

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

it("sets the impact point moving on the frame a shot connects", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "mote", AT);
  parkUnit(h, "mote", CONTROL_AT);
  await h.advance(1);

  standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const full = unitById(h.snapshot(), unit).maxHp;

  const played = await captureReplay(h, "impact", async () => {
    const hit = await h.until(
      (s) => s.units.some((u) => u.id === unit && u.hp < full),
      { maxFrames: ticks(3) },
    );
    const [subject, control] = await motionEach(h, [POINTS, CONTROL], WINDOW);
    return { hit: hit.hit, subject: subject ?? 0, control: control ?? 0 };
  });

  assertEqual(
    played.hit,
    true,
    "a Scrap Capacitor's shot to connect with a Mote eighty units away within " +
      "three seconds (specs/components.md)",
  );
  assertGreaterThan(
    played.subject,
    played.control + IDLE_STEP,
    "the point a shot connected at to change on more frames than the ground " +
      "around an identical unit nothing was fired at, read over the same " +
      "frames, by more than the one idle step their cycles can differ by, so " +
      "an impact burst is played there (specs/assets.md); the unit left alone " +
      `changed on ${played.control} of ${WINDOW} frames`,
  );
});
