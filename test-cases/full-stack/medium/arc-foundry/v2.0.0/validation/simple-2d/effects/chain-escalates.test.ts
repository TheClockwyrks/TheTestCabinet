// Arc Foundry — effects/chain-escalates: a Tesla-Prime chain is not a Scrap chain.
//
// THE REQUIREMENT, from `specs/assets.md`: "The firing effects escalate with the
// firing structure's quality tier ... a Scrap bolt is thin and dim where a
// Tesla-Prime bolt is fat and bright, and the same escalation applies to the chain,
// the spray, the ring, and the arc bolt."
//
// THE PRODUCED SYSTEMS ARE SERVED TO THE LOADER HERE, by `./produced.ts`, so what
// plays is the file the build committed.
//
// WHY THE READING IS BRIGHTNESS. The systems are simulated live and vary from one
// firing to the next, so two firings of the same structure already draw different
// pixels and a bare difference would pass every build. The specification states a
// direction, and mean brightness over the gaps the chain is drawn through, across
// the frames after it resolves, is that direction as a number.
//
// THE TWO CHAINS ARE THE SAME CHAIN BUT FOR THE TIER. Three held Slugs in a column
// sixty units apart, inside the `COIL_LEAP_RANGE` (`70`) of `specs/components.md`,
// and a Coil ninety units to the side of the top one — inside the Scrap range of
// `110`, so both tiers reach it — set to `nearest` so both tiers strike the same
// unit first and leap the same way. Both tiers carry enough additional leaps to
// strike all three: `2` at Scrap and `4` at Tesla-Prime.
//
// THE WAVE IS DEEP SO NOTHING DIES. `specs/components.md` gives a Tesla-Prime Coil
// `550` damage, which would remove a wave-one unit and put a death burst in the
// reading where a chain belongs. At wave twenty a Slug's scaled health is several
// times that (`specs/enemies.md`), so every unit survives both chains and the two
// readings hold the same thing.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  standComponent,
  structureCenter,
  ticks,
  unitById,
  type Harness,
  type Tier,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { between, brightnessOverFrames } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 22, row: 15 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Three held units in a column, sixty apart: inside `COIL_LEAP_RANGE` (`70`). */
const FIRST = { x: HEAD.x + 90, y: HEAD.y };
const SECOND = { x: FIRST.x, y: FIRST.y + 60 };
const THIRD = { x: FIRST.x, y: FIRST.y + 120 };

/** The two gaps, sampled clear of each Slug's own `32 x 32` frame. */
const POINTS = [
  ...between(FIRST, SECOND, 20, 5),
  ...between(SECOND, THIRD, 20, 5),
];

/** A wave deep enough that a Tesla-Prime Coil cannot remove a Slug. */
const WAVE = 20;

/** Frames after the chain resolves that the reading covers. */
const AFTER = ticks(0.2);

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The mean brightness of the two gaps across one chain, at that tier. */
async function chainBrightness(tier: Tier): Promise<number> {
  emptyYard(h);
  const coil = standComponent(h, "coil", tier, ANCHOR.col, ANCHOR.row);
  h.debug.setTargeting(coil, "nearest");
  const primary = parkUnit(h, "slug", FIRST);
  parkUnit(h, "slug", SECOND);
  parkUnit(h, "slug", THIRD);
  const full = unitById(h.snapshot(), primary).maxHp;
  const landed = await h.until(
    (s) => s.units.some((u) => u.id === primary && u.hp < full),
    { maxFrames: ticks(3) },
  );
  assertEqual(
    landed.hit,
    true,
    `a Coil at tier ${tier} to connect with the nearest unit within three ` +
      "seconds (specs/components.md)",
  );
  return brightnessOverFrames(h, POINTS, AFTER);
}

it("draws a brighter chain at Tesla-Prime than at Scrap", async () => {
  openYard(h, { wave: WAVE });
  const scrap = await chainBrightness(1);
  const teslaPrime = await captureReplay(h, "chains", () => chainBrightness(5));

  assertGreaterThan(
    teslaPrime,
    scrap,
    "the gaps a Tesla-Prime Coil's chain is drawn through to be brighter than " +
      "the gaps a Scrap Coil's chain is drawn through in the same scenario, " +
      `so the quality ladder reads in the effect (specs/assets.md); the Scrap ` +
      `chain measured ${scrap.toFixed(2)} of 255`,
  );
});
