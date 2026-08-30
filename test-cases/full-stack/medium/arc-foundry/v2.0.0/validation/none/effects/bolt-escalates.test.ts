// Arc Foundry — effects/bolt-escalates: a Tesla-Prime bolt is not a Scrap bolt.
//
// THE REQUIREMENT, from `specs/assets.md`: "The firing effects escalate with the
// firing structure's quality tier, so the ladder reads in the effects as well as in
// the sprites: a Scrap bolt is thin and dim where a Tesla-Prime bolt is fat and
// bright, and the same escalation applies to the chain, the spray, the ring, and
// the arc bolt."
//
// WHY THE READING IS BRIGHTNESS RATHER THAN A DIFFERENCE. Every system "is played
// live and simulated as it plays, so it varies from one firing to the next"
// (`specs/assets.md`), so two firings of the SAME structure already draw different
// pixels: asking only that the two tiers differ would be satisfied by any build at
// all, including one that plays the identical effect at both. What the
// specification actually states is a direction — thinner and dimmer against fatter
// and brighter — and mean brightness over the line, across the whole flight, is
// that direction as a number. It is measured over a hundred and twenty samples of
// the line, so what a single frame's random spray happened to do washes out.
//
// THE TWO FLIGHTS ARE THE SAME FLIGHT BUT FOR THE TIER. The same anchor, the same
// held Slug at the same eighty units — inside the Scrap Capacitor's stated range of
// `100`, so both tiers reach it — the same span of line, and the same number of
// frames counted from each shot's own frame. `specs/components.md` gives a
// Capacitor the same cadence and the same projectile at every tier, so the shot
// itself contributes the same brightness to both readings and what is left between
// them is the effect.
//
// THE SPAN IS OUTSIDE THE FOOTPRINT, so the tier's own head sprite — which does
// escalate, and is `sprites/component-heads`' point rather than this one — is not
// what is being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { structureCenter, type Tier } from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { brightnessOverFrames } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away: inside the Scrap Capacitor's stated range of `100`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** The line between the head and the target, clear of the `2` by `2` footprint. */
const POINTS = (() => {
  const points: { x: number; y: number }[] = [];
  for (let d = 30; d <= 62; d += 4) points.push({ x: HEAD.x + d, y: HEAD.y });
  return points;
})();

/** Frames of flight the reading covers, ending before the shot arrives. */
const FLIGHT = ticks(0.12);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The mean brightness of the line across one shot's flight, at that tier. */
async function boltBrightness(tier: Tier): Promise<number> {
  await emptyYard(h);
  await standComponent(h, "capacitor", tier, ANCHOR.col, ANCHOR.row);
  await parkUnit(h, "slug", AT);
  const fired = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(3),
  });
  assertEqual(
    fired.hit,
    true,
    `a Capacitor at tier ${tier} with a unit eighty units away to fire within ` +
      "three seconds (specs/components.md)",
  );
  return brightnessOverFrames(h, POINTS, FLIGHT);
}

it("draws a brighter bolt at Tesla-Prime than at Scrap", async () => {
  await openYard(h, { wave: 1 });
  const scrap = await boltBrightness(1);
  const teslaPrime = await captureReplay(h, "bolts", () => boltBrightness(5));

  assertGreaterThan(
    teslaPrime,
    scrap,
    "the line a Tesla-Prime Capacitor's shot travels down to be brighter " +
      "across the flight than the line a Scrap Capacitor's does in the same " +
      `scenario, so the quality ladder reads in the effect (specs/assets.md); ` +
      `the Scrap flight measured ${scrap.toFixed(2)} of 255`,
  );
});
