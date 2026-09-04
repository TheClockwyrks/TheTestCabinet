// surge/leak-costs-a-life — a Mote that reaches its exhaust takes one life and
// leaves the floor.
//
// THE RULE. specs/surge.md's table of what removes a unit: "It reached its
// assigned exhaust" costs "Its leak value in lives", and the roster gives the Mote
// a leak of `1`. specs/mazing.md fixes when that happens — "A unit leaves the
// floor when the tile its centre occupies is one of the opening tiles of its
// assigned exhaust" — and specs/waves.md adds that "Lives lost to a leak never
// come back".
//
// BOTH HALVES ARE READ, BECAUSE THEY ARE TWO DIFFERENT DEFECTS. A build that takes
// the life and leaves the unit walking on past the casing, and one that removes
// the unit and charges nothing for it, are both wrong and neither is the other. So
// this point reads the life the leak cost AND that the Mote is gone from the
// roster.
//
// THE FLOOR IS EMPTY BUT FOR THE LEAKER, which is what makes the reading
// unambiguous: with no tower standing there is no damage path at all, so the only
// way the unit can leave the roster is the one this point is about. Nothing is
// posed on the unit beyond its entry and its position — its locomotion is on and
// its route is recomputed from the tile the position falls in
// (specs/instrumentation.md) — so the last tile is walked under the game's own
// power.
//
// IT IS POSED ONE TILE SHORT OF THE OPENING (surge/roster.ts), on a row the right
// exhaust covers, because a unit that entered at the left vent is assigned the
// right exhaust for its whole life (specs/floor.md). That keeps this point off the
// walk across the floor, which specs/mazing.md owns and the `mazing` group
// decides.
//
// THE PHASE IS `building`. A wave clears only while the phase is `wave`
// (specs/waves.md), so a leak driven here cannot also pay a clear bonus or move
// the wave number, and the lives are moved by the leak and by nothing else.
//
// WHAT EVERY WRONG MODEL READS. A build that charges nothing for a leak reads `0`;
// one that charges a flat two for every type reads `2`, which is the Hulk's
// figure and not the Mote's; one that lets the unit walk on out of the reactor
// leaves it on the roster.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { livesLostTo } from "./roster";

/** The lives specs/surge.md's roster says a Mote's leak costs. */
const MOTE_LEAK = SURGE_DEFS.mote.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life and removes the Mote when it reaches its exhaust", async () => {
  const leak = await livesLostTo(h, "mote");
  captureStill(h, "leak");

  assertTrue(
    leak.leaked,
    "precondition: the Mote walked its last tile and reached its exhaust",
  );
  assertTrue(leak.gone, "the Mote left the roster on reaching its exhaust");
  assertEqual(leak.lost, MOTE_LEAK, "the lives the leak cost");
});
