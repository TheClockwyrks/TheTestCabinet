// screens/cleared-and-open-persist — a clear stands for the rest of the session.
//
// specs/ui.md, "Site select": "The site at index `0` is open from the start, the
// site at index `n + 1` opens once the site at index `n` is cleared, and cleared
// and open sites stay so for the session."
//
// ONE READING DECIDES BOTH HALVES. A site's openness is not a field of its own:
// specs/state.md carries `cleared`, one flag per site, and the site list derives
// what is open from it — site `n + 1` is open exactly because site `n` is
// cleared. So a clear that survives is a cleared site that still reads cleared
// AND the site after it that still reads open, and the flag is the whole of it.
//
// THE SESSION IS MADE TO PASS BETWEEN the clear and the reading, or the point
// asserts nothing beyond that the clear was recorded at all. So site 0 is
// cleared by a real run, then site 1 is opened and genuinely played — a crane
// stood, a tape written, a run started and aborted — and only then is the site
// list shown again. Opening a site is the operation that resets the most
// (specs/state.md), so it is the one most likely to take a clear down with it.
//
// The runs are on an emptied yard: specs/program.md ends a spent tape "cleared
// if every load is `placed`", and a yard holding no load has every load placed
// vacuously, so the clear needs no lift to succeed and the aborted run needs no
// load to leave alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site cleared, and the one played afterwards. */
const CLEARED_SITE = 0;
const OTHER_SITE = 1;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
];

const MAX_TICKS = 600;

/** Ticks of the second run before it is aborted: a run genuinely in progress. */
const PLAYED_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a site cleared after another site is played", async () => {
  await openSite(h, CLEARED_SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    MAX_TICKS,
    "the run to end",
  );
  assertEqual(
    ended.run.phase,
    "cleared",
    "the run to end cleared, its tape spent with no load left unplaced " +
      "(specs/program.md)",
  );
  assertTrue(
    ended.cleared[CLEARED_SITE] === true,
    `site ${CLEARED_SITE} to read cleared once its run cleared (specs/ui.md)`,
  );

  // Play elsewhere: a site opened, a crane stood, a tape written, a run begun
  // and aborted.
  await openSite(h, OTHER_SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  await h.advance(PLAYED_TICKS);
  await h.debug.abortRun();

  await h.debug.setScreen("select");
  const listed = await h.snapshot();
  assertEqual(listed.screen, "select", "the site list this point reads");
  assertTrue(
    listed.cleared[CLEARED_SITE] === true,
    `site ${CLEARED_SITE} to still read cleared after site ${OTHER_SITE} was ` +
      `played, so site ${OTHER_SITE} still reads open (specs/ui.md)`,
  );

  await h.capture("state", "the site list after another site was played");
});
