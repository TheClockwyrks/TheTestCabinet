// instrumentation/open-site-sets-the-site-index — openSite opens the site it
// names.
//
// `specs/instrumentation.md` § The run and the screens: `openSite(index)` "Opens
// site `index`, counted from `0`". Counting from `0` is the whole of the point, so
// the reading is the index the snapshot reports and the figures it reports beside
// it: § The site says "A site's name, envelope, anchors, budget, and par are the
// site's own figures, read by the open site's index against `specs/sites.md`", and
// § Snapshot shape repeats it — those five are "read by `siteIndex` against
// `specs/sites.md`".
//
// Index `4` is the site `specs/sites.md` heads "Site 5 — High Shelf", since that
// file numbers its headings from one and `specs/ui.md` fixes the relation: "A
// site's displayed number is its index plus one, so the first site is index `0`
// and shows as `1`." A build that counted the argument from one would open Long
// Reach and fail here, which is exactly what this point separates. The site's
// figures come from `SITES`, which `specs/sites.md` authors, so nothing is
// compared against the reference.
//
// The call is made from the title screen a reset leaves, with nothing else posed:
// the yard the site carries is another point's, and none of these five figures is
// something any operation can set.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SITE_NAMES, SITES } from "../constants";
import { createHarness, type Harness } from "../harness";

const SITE = 4;

const AUTHORED = SITES[SITE]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the site the index names, counted from zero", async () => {
  await h.debug.openSite(SITE);
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(s.siteIndex, SITE, `siteIndex after openSite(${SITE})`);
  assertEqual(
    s.site.name,
    SITE_NAMES[SITE],
    `the open site's name after openSite(${SITE}) (specs/sites.md)`,
  );
  assertDeepEqual(
    s.site.envelope,
    {
      min: {
        x: AUTHORED.envelope.x.min,
        y: AUTHORED.envelope.y.min,
        z: AUTHORED.envelope.z.min,
      },
      max: {
        x: AUTHORED.envelope.x.max,
        y: AUTHORED.envelope.y.max,
        z: AUTHORED.envelope.z.max,
      },
    },
    "the open site's build envelope (specs/sites.md)",
  );
  assertDeepEqual(
    s.site.anchors,
    AUTHORED.anchors,
    "the open site's anchors (specs/sites.md)",
  );
  assertEqual(
    s.site.budget,
    AUTHORED.budget,
    "the open site's budget (specs/sites.md)",
  );
  assertDeepEqual(
    s.site.par,
    AUTHORED.par,
    "the open site's par figures (specs/sites.md)",
  );
});
