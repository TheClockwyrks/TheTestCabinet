// instrumentation/reset-empties-every-stored-tape — a reset leaves every site's
// program empty.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] every site's
// stored structure and tape emptied". `specs/state.md` § The session says what is
// being emptied: "Per site: the structure and the tape authored on it, which
// persist across visits for the session", and § Snapshot shape says a stored one is
// read by opening its site — "A site that is not open reports the structure and
// tape stored on it through `structure` and `program` once it is opened."
//
// So the check authors a tape on TWO sites and reads both back after the reset: a
// build that emptied only the open site's tape would pass on one. Each tape is one
// move step, the smallest thing a tape can carry — `specs/program.md` accepts "a
// move only with at least one command" — at a rate inside the hoist's maximum, so
// the tape editor accepts it and the reading afterwards is about the reset alone.
// What the structure stores is its own point, so nothing is built.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two sites, so a build that emptied only the open one is caught. */
const SITES_TAPED = [0, 2] as const;

/** The smallest tape: one move step carrying one command. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the tape stored on every site", async () => {
  for (const site of SITES_TAPED) {
    await openSite(h, site);
    await clearAll(h);
    await poseTape(h, TAPE);
    assertLength(
      (await h.snapshot()).program,
      TAPE.length,
      `the tape authored on site ${site + 1}, which is the scenario this ` +
        "point rests on",
    );
  }

  await h.debug.reset();

  for (const site of SITES_TAPED) {
    await h.debug.openSite(site);
    const { program } = await h.snapshot();
    if (site === SITES_TAPED[SITES_TAPED.length - 1]) {
      await h.advance(1);
      await h.capture("state", "The driven state this point decides");
    }
    assertLength(
      program,
      0,
      `the tape stored on site ${site + 1} after a reset ` +
        "(specs/instrumentation.md)",
    );
  }
});
