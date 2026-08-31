// surge/core-leaks-five-lives — a Core that reaches its exhaust takes five lives.
//
// THE RULE. specs/surge.md's roster gives the Core a leak of `5`, the largest in
// the game, and the table of what removes a unit charges "Its leak value in lives"
// when "It reached its assigned exhaust". The prose says why: the Core is "the
// boss ... worth five lives if it escapes."
//
// THIS IS THE EDGE CASE OF ITS OWN, AND IT IS WHY IT IS A POINT. `leak-costs-a-life`
// reads a Mote's one life and `hulk-leaks-two-lives` a Hulk's two, and a build that
// capped a leak at two — or that treated anything past a Hulk as a Hulk — passes
// both. Five is the reading that separates a build looking the figure up in the
// roster from one that clamped it.
//
// THE ARRANGEMENT IS THE MOTE'S, TYPE FOR TYPE. An empty floor but for the leaker,
// so no damage path exists and the only way off the roster is the exhaust; the
// unit posed one tile short of the right exhaust on a row that opening covers and
// walking the last tile under its own power (surge/roster.ts); and a `building`
// phase, in which no wave can clear and nothing else can move the lives
// (specs/waves.md). The Core's `30` logical units a second is the slowest in the
// roster, and the drive's window is sized against exactly that figure.
//
// FIVE LIVES IS WELL INSIDE THE TWENTY A CONTAINMENT RUN OPENS WITH
// (specs/modes.md), so the leak does not take the lives to `0` and the run does
// not end on the frame this point reads. That matters: a run that ended would
// change the screen, and the reading would be taken across a transition instead of
// across the leak.
//
// WHAT EVERY WRONG MODEL READS. A build that charges one life for every leak reads
// `1`; one that capped the charge at the Hulk's two reads `2`; one that charged
// nothing reads `0`.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { livesLostTo } from "./roster";

/** The lives specs/surge.md's roster says a Core's leak costs. */
const CORE_LEAK = SURGE_DEFS.core.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes five lives when a Core reaches its exhaust", async () => {
  const leak = await livesLostTo(h, "core");
  captureStill(h, "leak");

  assertTrue(
    leak.leaked,
    "precondition: the Core walked its last tile and reached its exhaust",
  );
  assertEqual(leak.lost, CORE_LEAK, "the lives the leak cost");
});
