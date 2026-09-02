// field/filament-refuses-a-weight-outside-the-two — a weight other than 1 or 3 is
// refused.
//
// THE RULE. A filament "carries a `weight` of `1` OR `3`" (`specs/field.md`,
// Filaments and constellations) — the two, and nothing between or beyond them.
// `specs/formats.md` says the same of every filament a document writes down:
// "`weight` is `1` or `3`". The surface states the same domain,
// "`linkMotes(a, b, weight)` — joins motes `a` and `b` with one filament of
// `weight` `1` or `3`", under the rule the whole surface is written against: "an
// argument outside the domain its operation states is invalid, and the call fails
// loudly rather than guessing what was meant, except where an operation states
// that it normalizes or ignores the call" (`specs/instrumentation.md`).
// `linkMotes` states no normalizing and no ignoring.
//
// WHY IT MATTERS THAT IT THROWS RATHER THAN SHRUGS. A weight is not a decoration:
// a set accepts a constellation carrying "one filament of THE PATTERN'S WEIGHT
// for each pattern filament" (`specs/sigils.md`), so a filament of weight `2`
// would be a link no product can ever match and no sigil can ever have made.
//
// THE VERDICT is read in three parts, because no one of them is enough: every one
// of the weights `0`, `2` and `4` raises; no filament is created by any of them;
// and the SAME PAIR then links at weight `1`, so what was refused was the weight
// rather than the pair. `2` is the weight between the two the specification
// allows, `0` is below them and `4` above.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field and the
// machine, so the two motes are the whole of the world; they are spawned on
// adjacent hexes, so nothing else `linkMotes` refuses for — "motes on hexes that
// are not adjacent, a fixture at either end, and a pair a filament already joins
// each throw" — can be what refused these calls, and the control link proves it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { FILAMENT_WEIGHTS } from "../constants";
import { adjacent, neighbor } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  filamentBetween,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** Weights outside the two: below them, between them, and above them. */
const REFUSED = [0, 2, 4];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a weight that is neither 1 nor 3, and creates no filament", async () => {
  assertLength(FILAMENT_WEIGHTS, 2, "a filament carries a weight of 1 or 3");
  for (const weight of REFUSED) {
    assertTrue(
      !(FILAMENT_WEIGHTS as readonly number[]).includes(weight),
      `${weight} is neither 1 nor 3`,
    );
  }

  const east = neighbor(ORIGIN, 0);
  assertTrue(
    adjacent(ORIGIN, east),
    "the two hexes are adjacent, so nothing but the weight can refuse the link",
  );

  await openBareRun(h, { challenge: BARE });
  const a = await spawnMote(h, ORIGIN, "dust");
  const b = await spawnMote(h, east, "dust");

  const raised: number[] = [];
  for (const weight of REFUSED) {
    try {
      await h.debug.linkMotes(a, b, weight);
    } catch {
      raised.push(weight);
    }
  }

  await h.advance(1);
  await captureStill(h, "refused");

  const refusedAll = await h.snapshot();
  for (const weight of REFUSED) {
    assertTrue(
      raised.includes(weight),
      `a filament of weight ${weight} fails loudly, since a filament carries 1 or 3`,
    );
  }
  assertLength(
    refusedAll.sim?.filaments ?? [],
    0,
    "no refused call created a filament",
  );
  assertEqual(
    filamentBetween(refusedAll, a, b),
    null,
    "the pair is left unjoined by the refused weights",
  );

  await h.debug.linkMotes(a, b, 1);
  const joined = await h.snapshot();
  assertNotNull(
    filamentBetween(joined, a, b),
    "the same pair links at weight 1, so the weight is what the refusals were about",
  );
});
