// Arc Foundry — effects/status-colors-distinct: the slow, burn and aura effects
// each carry a color of their own.
//
// THE REQUIREMENT, from `specs/assets.md`, immediately under the table of the
// twelve: "The slow, burn, and aura systems each carry a color of their own,
// distinct from each other and from the firing effects, so a player reads which
// effect is on a unit without reading a number."
//
// HOW A SYSTEM'S COLOR IS READ. `particle-2d` authors color as keyed stops over
// a particle's life, so a system's color is the mean of every stop of every one
// of its emitters. A system with no stop at all has no color of its own and
// fails, which is the same miss written a different way.
//
// THE FIRING EFFECTS ARE READ AS ONE. `specs/assets.md` names them as a group —
// "the same escalation applies to the chain, the spray, the ring, and the arc
// bolt" — and the requirement is that each status color is apart from that group,
// so the four systems' stops are pooled into one mean and each status color is
// held against it.
//
// THE TOLERANCE. `60` of the `441` a full RGB diagonal spans, in plain euclidean
// distance over the three channels. It is a floor rather than a target: two
// colors that close are read as the same color at a glance, which is the thing
// the requirement is about, and a build is free to put them as far apart as it
// likes. Nothing about hue, saturation or which color goes with which effect is
// asserted — an icy slow and a molten burn satisfy this exactly as a violet slow
// and a green burn do.

import { afterEach, beforeEach, it } from "vitest";

import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  tileCenter,
  type Harness,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { evidence } from "./region";
import {
  FIRING_EFFECTS,
  STATUS_EFFECTS,
  colorDistance,
  colorStops,
  meanColor,
  readSystem,
  type EffectName,
} from "./systems";

/** How far apart, of 441, two colors must be to read as two colors. */
const APART = 60;

/** The mean of every color stop of every emitter of one produced system. */
function colorOf(effect: EffectName): [number, number, number] | null {
  const stops = colorStops(readSystem(effect));
  return stops.length === 0 ? null : meanColor(stops);
}

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps slow, burn and aura apart from each other and from the firing effects", async () => {
  await evidence(h, "colors", async () => {
    // One unit carrying both statuses, beside a support node, so the still shows
    // the three colors the reading is about on one screen.
    openYard(h, { wave: 1 });
    standComponent(h, "regulator", 3, 20, 14);
    const unit = parkUnit(h, "slug", tileCenter(25, 15), {
      slow: { amount: 0.3, seconds: 4 },
      burn: { dps: 2, seconds: 4 },
    });
    h.debug.select(unit);
    await h.advance(2);
  });

  const colorless = [...STATUS_EFFECTS, ...FIRING_EFFECTS]
    .filter((effect) => colorOf(effect) === null)
    .map((effect) => `fx/${effect}.json`);
  assertDeepEqual(
    colorless,
    [],
    "each of the slow, burn, aura and firing systems to carry color stops of " +
      "its own (specs/assets.md)",
  );

  const firing = meanColor(
    FIRING_EFFECTS.flatMap((effect) => colorStops(readSystem(effect))),
  );
  const status = new Map(
    STATUS_EFFECTS.map((effect) => [effect, colorOf(effect)!] as const),
  );

  const tooClose: string[] = [];
  for (const [effect, color] of status) {
    const d = colorDistance(color, firing);
    if (d <= APART) {
      tooClose.push(
        `${effect} is ${d.toFixed(1)} of 441 from the firing effects' color`,
      );
    }
  }
  for (let i = 0; i < STATUS_EFFECTS.length; i += 1) {
    for (let j = i + 1; j < STATUS_EFFECTS.length; j += 1) {
      const a = STATUS_EFFECTS[i]!;
      const b = STATUS_EFFECTS[j]!;
      const d = colorDistance(status.get(a)!, status.get(b)!);
      if (d <= APART) {
        tooClose.push(`${a} and ${b} are ${d.toFixed(1)} of 441 apart`);
      }
    }
  }
  assertDeepEqual(
    tooClose,
    [],
    `the slow, burn and aura colors to be more than ${APART} of 441 apart ` +
      `from one another and from the firing effects' color, so a player reads ` +
      `which effect is on a unit (specs/assets.md)`,
  );
});
