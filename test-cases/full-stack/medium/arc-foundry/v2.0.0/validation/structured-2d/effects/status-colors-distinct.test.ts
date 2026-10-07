// Arc Foundry — effects/status-colors-distinct: the slow, burn and aura effects
// each carry a color of their own.
//
// THE REQUIREMENT, from `specs/assets.md`, immediately under the table of the
// twelve: "The slow, burn, and aura systems each carry a color of their own,
// distinct from each other and from the firing effects, so a player reads which
// effect is on a unit without reading a number."
//
// HOW A SYSTEM'S COLOR IS READ. `particle-2d` authors color as keyed stops over a
// particle's life, so a system's color is the list of every stop of every one of
// its emitters. A system with no stop at all has no color of its own and fails,
// which is the same miss written a different way.
//
// WHAT IS COMPARED, AND WHY IT IS AN EXACT COMPARISON. Two systems carry the same
// color when they carry the same authored gradient, so the three status systems'
// stop lists are held against each other and against each firing effect's, and a
// repeat is the miss. That is the same shape `effects/systems-distinct` uses on the
// authored bodies, and it asserts nothing about how a color LOOKS: which hue goes
// with which effect, how saturated it is, and how far apart two of them read on a
// screen are the build's, and the reviewer's presentation rating is what judges
// them. An icy slow and a molten burn satisfy this exactly as a violet slow and a
// green burn do.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
} from "../harness";
import { evidence } from "./region";
import {
  FIRING_EFFECTS,
  STATUS_EFFECTS,
  colorStops,
  readSystem,
  type EffectName,
} from "./systems";
import { tileCenter } from "../constants";

/**
 * Every color stop of every emitter of one produced system, as one comparable
 * value, or `null` where the system carries no stop at all.
 */
function gradientOf(effect: EffectName): string | null {
  const stops = colorStops(readSystem(effect));
  return stops.length === 0 ? null : JSON.stringify(stops);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps slow, burn and aura apart from each other and from the firing effects", async () => {
  await evidence(h, "colors", async () => {
    // One unit carrying both statuses, beside a support node, so the still shows
    // the three colors the reading is about on one screen. The node is what is
    // selected, not the unit: `select` names a STRUCTURE (specs/instrumentation.md),
    // and selecting it is what draws its aura, so the frame carries the slow and
    // the burn on the unit and the aura around the node.
    openYard(h, { wave: 1 });
    const node = standComponent(h, "regulator", 3, 20, 14);
    parkUnit(h, "slug", tileCenter(25, 15), {
      slow: { amount: 0.3, seconds: 4 },
      burn: { dps: 2, seconds: 4 },
    });
    h.debug.select(node);
    await h.advance(2);
  });

  const colorless = [...STATUS_EFFECTS, ...FIRING_EFFECTS]
    .filter((effect) => gradientOf(effect) === null)
    .map((effect) => `fx/${effect}.json`);
  assertDeepEqual(
    colorless,
    [],
    "each of the slow, burn, aura and firing systems to carry color stops of " +
      "its own (specs/assets.md)",
  );

  const repeated: string[] = [];
  for (let i = 0; i < STATUS_EFFECTS.length; i += 1) {
    const a = STATUS_EFFECTS[i]!;
    for (const b of [...STATUS_EFFECTS.slice(i + 1), ...FIRING_EFFECTS]) {
      if (gradientOf(a) === gradientOf(b)) {
        repeated.push(`${a} and ${b} carry the same color stops`);
      }
    }
  }
  assertDeepEqual(
    repeated,
    [],
    "the slow, burn and aura systems each to carry a color of their own, " +
      "distinct from each other and from the firing effects (specs/assets.md)",
  );
});
