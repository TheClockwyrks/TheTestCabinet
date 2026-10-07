// instrumentation/reset-opens-site-zero — a reset leaves site 0 open, whatever
// site was open before it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: the `title`
// screen with `menuIndex` `0`, site `0` open, …". Site `0` is `First Lift`
// (`specs/sites.md`, whose `SITE_NAMES` carries the six names in order), so the
// site open after a reset is read both by its index and by the name the snapshot
// reports for it — one requirement, read the two ways the snapshot states it.
//
// ANOTHER SITE IS OPENED FIRST, and the furthest one that is not site 0 makes the
// weakest reset visible: `openSite` "opens site `index`, counted from `0`, locked
// or not", so site 5 is reached without playing the four sites before it and
// without pressing a key on the select screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SITE_COUNT, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The last site: as far from site 0 as the catalogue reaches. */
const POSED = SITE_COUNT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves site 0 open", async () => {
  await openSite(h, POSED);
  assertEqual(
    (await h.snapshot()).siteIndex,
    POSED,
    `the site openSite(${POSED}) opened, before the reset`,
  );

  await h.debug.reset();
  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("site", "The site a reset leaves open");

  assertEqual(
    s.siteIndex,
    0,
    "siteIndex after a reset (specs/instrumentation.md)",
  );
  assertEqual(
    s.site.name,
    SITE_NAMES[0],
    "the name of the site a reset leaves open (specs/sites.md)",
  );
});
