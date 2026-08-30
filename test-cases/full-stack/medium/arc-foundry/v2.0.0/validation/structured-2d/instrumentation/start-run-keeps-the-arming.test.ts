// instrumentation/start-run-keeps-the-arming — an armed roll survives the run start.
//
// `specs/instrumentation.md` names the two ways an arming ends, and names them
// exhaustively: `setNextRoll` "arms the NEXT rock ... The arming survives until a
// rock consumes it or `clearNextRoll` clears it." `reset` is separately licensed
// to end one, because its title state lists "the press unarmed" among what it
// restores. `startRun` is not: it "gives the run the opening allocation
// `specs/campaign.md` states and nothing more".
//
// WHY IT MATTERS TO EVERY OTHER POINT. Arming the press is how a check gets the
// component it is about instead of whatever the odds rolled, and the harness
// opens almost every scenario by entering a run. A build that unarms the press on
// the way in leaves the arming silently spent, and the check that asked for a
// Rectifier at tier 4 gets whatever the press felt like.
//
// BOTH HALVES OF THE SENTENCE, IN ONE POSE. The arming is read after the run
// opens, and then the rock that consumes it is placed and the arming is read
// again: one behaviour, "until a rock consumes it", read at the two points it
// fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  emptyYard,
  lastStructure,
  type Harness,
} from "../harness";

/** A type and a tier the opening odds would almost never produce together. */
const ARMED = { type: "discharge", quality: 4 } as const;

/** An anchor clear of the Substation's chain, its entry and its collector. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries an armed roll into the run and spends it on the first rock", async () => {
  h.debug.reset();
  h.debug.setNextRoll(ARMED.type, ARMED.quality);
  h.debug.startRun();

  const opened = h.snapshot();
  assertDeepEqual(
    opened.nextRoll,
    { type: ARMED.type, quality: ARMED.quality },
    "the arming after startRun, which clears no arming of its own " +
      "(specs/instrumentation.md)",
  );

  emptyYard(h);
  h.debug.placeRock(ANCHOR.col, ANCHOR.row);
  captureStill(h, "armed");

  const rolled = h.snapshot();
  const candidate = lastStructure(rolled);
  assertEqual(candidate.kind, "candidate", "what the rock landed as");
  assertEqual(candidate.type, ARMED.type, "the type the armed rock rolled");
  assertEqual(
    candidate.quality,
    ARMED.quality,
    "the tier the armed rock rolled",
  );
  assertNull(
    rolled.nextRoll,
    "the arming after a rock consumed it (specs/instrumentation.md)",
  );
});
