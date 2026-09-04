// extras/challenge-5-ascendant — Extras 5 is Ascendant, exactly as `specs/challenges.md`
// writes it.
//
// THE RULE. "The Extras hold exactly `EXTRA_COUNT` (`10`) challenges, numbered
// `1` through `10`. `specs/challenges.md` is authoritative for every one of them:
// build each exactly as written there, in that order" (`specs/modes/extras.md`,
// The shelf). And `specs/challenges.md` itself: "This file gives every challenge
// of the Extras, in order. It is authoritative for all of them. Build every
// challenge exactly as written here, in the challenge format `specs/formats.md`
// defines." Challenge 5 is written there as:
//
//     {
//       "name": "Ascendant",
//       "reagents": [
//         { "motes": [{ "q": 0, "r": 0, "type": "mercury" }], "filaments": [] },
//         { "motes": [{ "q": 0, "r": 0, "type": "saturn" }], "filaments": [] }
//       ],
//       "products": [{ "motes": [{ "q": 0, "r": 0, "type": "jupiter" }], "filaments": [] }],
//       "permitted": ["arm", "ascend"],
//       "target": 6
//     }
//
// WHERE IT IS READ. `openChallenge("extras", 4)` makes it the open challenge —
// "the open challenge becomes that mode's shipped challenge at `index`, and the
// game moves to the editor" — and the snapshot reports it under `challenge`,
// whose `reagents` and `products` are "exactly the formats of specs/formats.md"
// (`specs/instrumentation.md`).
//
// WHAT IS COMPARED, AND WHAT IS NOT. A challenge is DATA rather than text, so
// each field is held against its MEANING and never against a spelling
// `specs/formats.md` leaves free. `permitted` "is non-empty and lists the part
// kinds the tray offers, in any order and without duplicates", so it is compared
// as a set — sorted on both sides, which fails a duplicate as readily as a
// missing kind. A molecule's `motes` are entries that each "places one mote type
// at `(q, r)`" with "no two entries share a hex", and its `filaments` are a list
// of links each joining "two distinct mote hexes of this molecule that are
// adjacent", so both are compared as sets and a filament's two ends unordered.
// The order of `reagents` and of `products` IS fixed, because a rise and a set
// carry `index`, "which reagent or product, from `0`", so those two lists are
// compared position by position.
//
// WHAT ASCENDANT ASKS FOR. TWO reagents — a single `mercury`, then a single
// `saturn` — and one `jupiter` out, with `ascend` beside the arm. The order of the
// two reagents is load-bearing here and not merely cosmetic: `rise` carries
// `index`, "which reagent or product, from `0`" (`specs/formats.md`, Solutions),
// so a shelf that listed `saturn` first would hand every machine written for this
// challenge the wrong mote off rise `0`.
//
// THE VERDICT. Extras `5` reports the name `Ascendant`, its `mercury` reagent at
// index `0` and its `saturn` reagent at index `1`, its one `jupiter` product, a
// `permitted` of `arm` and `ascend`, and the target `6`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { extra } from "../challenges";
import { CONSTELLATION_TARGET } from "../constants";
import type { Molecule } from "../formats";
import {
  captureStill,
  createHarness,
  openChallenge,
  type Harness,
} from "../harness";

/** Which Extra this is, from `0`: challenge 5 of `specs/challenges.md`. */
const INDEX = 4;

/** What the shelf is numbered from, so a message reads as the shelf reads. */
const NUMBER = INDEX + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One molecule's motes as an order-free set of `(q, r) type` keys. */
function moteKeys(pattern: Molecule): string[] {
  return (pattern.motes ?? [])
    .map((entry) => `(${entry.q}, ${entry.r}) ${entry.type}`)
    .sort();
}

/** One molecule's filaments as an order-free set, each link's ends unordered. */
function filamentKeys(pattern: Molecule): string[] {
  return (pattern.filaments ?? [])
    .map((entry) => {
      const ends = [
        `(${entry.a.q}, ${entry.a.r})`,
        `(${entry.b.q}, ${entry.b.r})`,
      ].sort();
      return `${ends[0]} to ${ends[1]} at weight ${entry.weight}`;
    })
    .sort();
}

/**
 * One molecule's `repeat` as a single comparable key, `null` when it carries
 * none — which is what both an absent `repeat` and a `repeat` of `null` are.
 */
function repeatKey(pattern: Molecule): string | null {
  const repeat = pattern.repeat;
  if (repeat === undefined || repeat === null) return null;
  const link = repeat.link;
  return `by (${repeat.vector.q}, ${repeat.vector.r}), linking (${link.a.q}, ${link.a.r}) to (${link.b.q}, ${link.b.r}) at weight ${link.weight}`;
}

/** Hold one molecule the build reports against the one the specification writes. */
function assertMolecule(found: Molecule, wanted: Molecule, at: string): void {
  assertTrue(
    Array.isArray(found.motes),
    `${at} reports a motes list, as every molecule pattern carries one`,
  );
  assertTrue(
    Array.isArray(found.filaments),
    `${at} reports a filaments list, which may be empty but is always there`,
  );
  assertDeepEqual(
    moteKeys(found),
    moteKeys(wanted),
    `${at} holds exactly the motes specs/challenges.md places in it`,
  );
  assertDeepEqual(
    filamentKeys(found),
    filamentKeys(wanted),
    `${at} holds exactly the filaments specs/challenges.md joins it with`,
  );
  assertEqual(
    repeatKey(found),
    repeatKey(wanted),
    `${at} repeats exactly as specs/challenges.md writes it, or not at all`,
  );
}

it("opens Ascendant exactly as specs/challenges.md writes it", async () => {
  const wanted = extra(INDEX);

  await openChallenge(h, "extras", INDEX);
  await captureStill(h, "opened");

  const view = (await h.snapshot()).challenge;
  assertNotNull(view, `Extras ${NUMBER} opens in the editor as a challenge`);
  if (view === null) return;

  assertEqual(
    view.name,
    wanted.name,
    `Extras ${NUMBER} carries the name specs/challenges.md gives it`,
  );
  assertEqual(
    wanted.target,
    CONSTELLATION_TARGET,
    "specs/challenges.md writes this challenge's target as CONSTELLATION_TARGET, which every challenge in this game uses",
  );
  assertEqual(
    view.target,
    wanted.target,
    `Extras ${NUMBER} carries the target specs/challenges.md gives it`,
  );
  assertDeepEqual(
    [...view.permitted].sort(),
    [...wanted.permitted].sort(),
    `Extras ${NUMBER}'s tray offers exactly the kinds specs/challenges.md permits, in any order and without duplicates`,
  );

  assertEqual(
    view.reagents.length,
    wanted.reagents.length,
    `Extras ${NUMBER} holds exactly the reagents specs/challenges.md gives it`,
  );
  for (const [n, want] of wanted.reagents.entries()) {
    assertMolecule(view.reagents[n], want, `Extras ${NUMBER}'s reagent ${n}`);
  }

  assertEqual(
    view.products.length,
    wanted.products.length,
    `Extras ${NUMBER} holds exactly the products specs/challenges.md gives it`,
  );
  for (const [n, want] of wanted.products.entries()) {
    assertMolecule(view.products[n], want, `Extras ${NUMBER}'s product ${n}`);
  }
});
