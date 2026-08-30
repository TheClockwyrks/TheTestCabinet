// Arc Foundry — effects/status-colors-distinct: the slow, burn and aura effects
// each carry a colour of their own.
//
// THE REQUIREMENT, from `specs/assets.md`, immediately under the table of the
// twelve: "The slow, burn, and aura systems each carry a colour of their own,
// distinct from each other and from the firing effects, so a player reads which
// effect is on a unit without reading a number."
//
// HOW A SYSTEM'S COLOUR IS READ. `particle-2d` authors colour as keyed stops over
// a particle's life, so a system's colour is the mean of every stop of every one
// of its emitters. A system with no stop at all has no colour of its own and
// fails, which is the same miss written a different way.
//
// THE FIRING EFFECTS ARE READ AS ONE. `specs/assets.md` names them as a group —
// "the same escalation applies to the chain, the spray, the ring, and the arc
// bolt" — and the requirement is that each status colour is apart from that group,
// so the four systems' stops are pooled into one mean and each status colour is
// held against it.
//
// THE TOLERANCE. `60` of the `441` a full RGB diagonal spans, in plain euclidean
// distance over the three channels. It is a floor rather than a target: two
// colours that close are read as the same colour at a glance, which is the thing
// the requirement is about, and a build is free to put them as far apart as it
// likes. Nothing about hue, saturation or which colour goes with which effect is
// asserted — an icy slow and a molten burn satisfy this exactly as a violet slow
// and a green burn do.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { tileCenter } from "../constants";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";
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

/** How far apart, of 441, two colours must be to read as two colours. */
const APART = 60;

/** The mean of every colour stop of every emitter of one produced system. */
function colorOf(effect: EffectName): [number, number, number] | null {
  const stops = colorStops(readSystem(effect));
  return stops.length === 0 ? null : meanColor(stops);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps slow, burn and aura apart from each other and from the firing effects", async () => {
  await evidence(h, "colors", async () => {
    // One unit carrying both statuses, beside a support node, so the still shows
    // the three colours the reading is about on one screen.
    await openYard(h, { wave: 1 });
    await standComponent(h, "regulator", 3, 20, 14);
    const unit = await parkUnit(h, "slug", tileCenter(25, 15), {
      slow: { amount: 0.3, seconds: 4 },
      burn: { dps: 2, seconds: 4 },
    });
    await h.debug.select(unit);
    await h.advance(2);
  });

  const colorless = [...STATUS_EFFECTS, ...FIRING_EFFECTS]
    .filter((effect) => colorOf(effect) === null)
    .map((effect) => `fx/${effect}.json`);
  assertDeepEqual(
    colorless,
    [],
    "each of the slow, burn, aura and firing systems to carry colour stops of " +
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
        `${effect} is ${d.toFixed(1)} of 441 from the firing effects' colour`,
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
    `the slow, burn and aura colours to be more than ${APART} of 441 apart ` +
      `from one another and from the firing effects' colour, so a player reads ` +
      `which effect is on a unit (specs/assets.md)`,
  );
});
