// surge/hulk-leaks-two-lives — a Hulk that reaches its exhaust takes two lives.
//
// THE RULE. specs/surge.md's roster gives the Hulk a leak of `2`, twice the
// Mote's, and the table of what removes a unit charges "Its leak value in lives"
// when "It reached its assigned exhaust". The prose says why: "The Hulk is slow
// and heavy and costs two lives if it escapes."
//
// THIS IS THE EDGE CASE OF ITS OWN, AND IT IS WHY IT IS A POINT. `leak-costs-a-life`
// reads a Mote and a Mote alone, so a build that charges one life for every leak
// whatever escaped passes it outright. Two lives is the reading that separates a
// build looking the figure up in the roster from one that took every leak to cost
// the same, and it fails here without touching the Mote's point.
//
// THE ARRANGEMENT IS THE MOTE'S, TYPE FOR TYPE. An empty floor but for the leaker,
// so no damage path exists and the only way off the roster is the exhaust; the
// unit posed one tile short of the right exhaust on a row that opening covers and
// walking the last tile under its own power (surge/roster.ts); and a `building`
// phase, in which no wave can clear and nothing else can move the lives
// (specs/waves.md). The Hulk's `38` logical units a second is the second slowest
// in the roster, and the drive's window is sized for the slowest of all.
//
// WHAT EVERY WRONG MODEL READS. A build that charges one life for every leak reads
// `1`; one that charged nothing reads `0`; one that read the leak column off the
// hp or the bounty reads neither `1` nor `2`.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { livesLostTo } from "./roster";

/** The lives specs/surge.md's roster says a Hulk's leak costs. */
const HULK_LEAK = SURGE_DEFS.hulk.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes two lives when a Hulk reaches its exhaust", async () => {
  const leak = await livesLostTo(h, "hulk");
  captureStill(h, "leak");

  assertTrue(
    leak.leaked,
    "precondition: the Hulk walked its last tile and reached its exhaust",
  );
  assertEqual(leak.lost, HULK_LEAK, "the lives the leak cost");
});
