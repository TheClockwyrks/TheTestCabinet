// instrumentation/posed-loads-do-not-reach-another-site — a yard posed on one
// site stays on that site.
//
// specs/state.md § The open site states where the yard comes from and what that
// buys: the loads and the obstacles are "the open site's own copies, taken from
// the fixed set `specs/sites.md` gives when the site is opened, so nothing the
// state holds points into that set and a load posed on one site is not carried
// onto the next."
//
// So the scenario poses a yard nobody authored — site 1's crate cleared away, a
// drum and a wall put in its place — and then opens the NEXT site and reads what
// that site carries. `specs/sites.md` authors site 2, `Turnabout`, with two
// crates and no obstacle, and that is exactly what it has to report. A build
// whose open yard is one shared value, or whose site opening does not refill it
// from the fixed set, carries the posed drum and the posed wall across, and this
// is the reading that sees it.
//
// The posed yard is deliberately unlike anything authored: a drum where no site
// authors one, and an obstacle on a site `specs/sites.md` gives none, so a yard
// that leaked is a yard that reads visibly wrong rather than one that happens to
// resemble what belongs there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { SITES, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The site the yard is posed on, and the one read afterwards. */
const POSED = 0;
const NEIGHBOUR = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the next site's authored yard exactly as specs/sites.md writes it", async () => {
  await openSite(h, POSED);
  await h.debug.clearLoads();
  await h.debug.addLoad("drum", 200, 0, 3, 0, 45);
  await h.debug.addObstacle(0, 0, 0, 4, 4, 4);

  // What the pose left, so a failure can say the pose landed at all rather than
  // that the neighbour was never touched.
  const posed = await h.snapshot();
  assertLength(posed.site.loads, 1, `the load posed on site ${POSED + 1}`);
  assertLength(
    posed.site.obstacles,
    1,
    `the obstacle posed on site ${POSED + 1}`,
  );

  await openSite(h, NEIGHBOUR);
  const s = await h.snapshot();
  const authored = SITES[NEIGHBOUR]!;

  assertEqual(
    s.site.name,
    SITE_NAMES[NEIGHBOUR],
    `the site openSite(${NEIGHBOUR}) opened`,
  );
  assertDeepEqual(
    s.site.loads,
    authored.loads,
    `site ${NEIGHBOUR + 1}'s authored loads, untouched by the yard posed on ` +
      `site ${POSED + 1} (specs/sites.md, specs/state.md)`,
  );
  assertDeepEqual(
    s.site.obstacles,
    authored.obstacles,
    `site ${NEIGHBOUR + 1}'s authored obstacles, untouched by the wall posed ` +
      `on site ${POSED + 1} (specs/sites.md, specs/state.md)`,
  );

  await h.advance(1);
  await h.capture("sites-intact", "The neighbouring site's authored yard");
});
