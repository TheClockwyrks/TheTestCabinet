// modes/hundred-hp-factor — every unit of the onslaught is six times as tough,
// wherever in the onslaught it arrives.
//
// THE RULE. specs/modes.md, The Hundred: "Every unit's maximum hp is its base hp
// times `HUNDRED_HP_SCALE` (`6.0`), wherever in the onslaught it arrives, in place
// of the per-wave scaling." The base hp of each type is specs/surge.md's roster,
// `SURGE_DEFS`, and the figure is read back as a unit's `maxHp` (surface.ts).
//
// THE FACTOR REPLACES THE PER-WAVE SCALING RATHER THAN COMPOUNDING WITH IT, and the
// onslaught is Wave 1, where specs/waves.md's `hpScale(1)` is `1`. So the two models
// are not told apart by the wave number — they are told apart by the factor itself,
// and `6.0` against `1` is a gulf: the smallest unit in the game, the Swarm at `12`
// base hp, reads `72` under the specification and `12` under a build that kept the
// per-wave scaling.
//
// EACH UNIT IS READ AGAINST ITS OWN REPORTED TYPE. The composition of the onslaught
// — that it "cycles the types of `WAVE_CYCLE` one unit at a time" — is not this
// point's requirement, so a build that fields the wrong types is still given a fair
// reading of its hp factor: whatever type a unit says it is, its `maxHp` must be
// that type's base hp times six.
//
// "WHEREVER IN THE ONSLAUGHT IT ARRIVES" IS WHY THE WHOLE RELEASE IS WATCHED rather
// than its first few units. A build that applied the flat factor to the first unit
// and then let something accumulate — a per-unit ramp, a per-second one, the
// per-wave scaling creeping back in — reads correctly at the front and wrongly at
// the back, and only a window that covers the release can see it. The window is
// seventy seconds, which is geometry rather than a tolerance: the hundredth unit is
// due `99 * 0.6` = `59.4` seconds in (specs/modes.md, specs/waves.md).
//
// HOW MANY ARRIVE IS NOT DECIDED HERE. `modes.hundred-releases-one-hundred` decides
// the count; this point reads every unit that DID arrive and requires the factor of
// each, so the two items name different defects. That a build released something at
// all is stated as a precondition, because a point that read no unit would have
// decided nothing.
//
// THE UNITS ARE HELD WHERE THEY ARRIVE, for the reason modes/run.ts gives: left
// walking, twenty of them leak away The Hundred's twenty lives and end the run less
// than half way through the release, and the back of the onslaught — the half this
// point exists to read — would never be released at all. The hp is read on the frame
// a unit first appears, before it is held, so what is read is the spawner's own.
//
// THE TOLERANCE IS FLOATING-POINT ROUND-TRIP AND NOTHING MORE. Every product the
// specification fixes here is a whole number — `40 * 6` is `240`, `24 * 6` is `144`,
// `12 * 6` is `72`, `60 * 6` is `360`, `220 * 6` is `1320` — so a thousandth of a hit
// point admits no wrong model at all: the nearest one, the per-wave scaling's factor
// of `1`, is two hundred hit points away for a Mote.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { HUNDRED_HP_SCALE, SURGE_DEFS } from "../constants";
import { captureStill, createHarness, seconds, type Harness } from "../harness";
import { beginOnslaught, ONSLAUGHT_TICKS, watchOnslaught } from "./run";

/**
 * The decimal places the factor is read to: three, a thousandth of a hit point.
 *
 * Every figure the specification fixes here is a whole number of hit points, so
 * this covers the round-trip of a product through a float and admits nothing else.
 */
const HP_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every unit of the onslaught six times its base hp, front to back", async () => {
  await beginOnslaught(h);

  const watched = await watchOnslaught(h, ONSLAUGHT_TICKS);
  captureStill(h, "tough");

  assertGreaterThan(
    watched.released.length,
    0,
    `precondition: the onslaught released a unit inside ` +
      `${seconds(ONSLAUGHT_TICKS)} seconds, so there is an hp to read`,
  );

  watched.released.forEach((unit, index) => {
    const base = SURGE_DEFS[unit.type].hp;
    assertCloseTo(
      unit.maxHp,
      base * HUNDRED_HP_SCALE,
      HP_DIGITS,
      `the maxHp of unit ${index + 1} of the onslaught, a ${unit.type} whose ` +
        `base hp is ${base} (specs/modes.md, The Hundred)`,
    );
  });
});
