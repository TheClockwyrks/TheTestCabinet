// sites/site-names-in-order — the six sites carry the six names, in the order
// the specification writes them.
//
// specs/sites.md § The site table: "`SITE_NAMES` carries the six names in order:
// `First Lift`, `Turnabout`, `Over the Wall`, `Long Reach`, `High Shelf`,
// `Heavy Haul`." The same section says `SITES` carries the six sites "in the
// order above", so a site's index and its name are fixed together: the name is
// how a player tells one site from another on the select screen and on the build
// screen (specs/ui.md), and a game that shuffled the names would send a player
// to the wrong yard from a correct choice.
//
// THE ORDER IS THE REQUIREMENT, which is why the six are read as one point and
// against one index each: a build carrying all six names in the wrong order
// carries none of them where the specification put it, and a build that reads
// them off some other list carries the wrong name at exactly the index that
// list differs at. `openSite(index)` "opens site `index`, counted from `0`,
// locked or not", so all six are reachable in one harness without playing five
// sites to reach the sixth.
//
// THE READING IS EACH SITE AS IT OPENS. A name is authored data rather than a
// run outcome: six `openSite` calls and six snapshots, with nothing built,
// nothing emptied and nothing ticked.
//
// THE STILL IS THE SELECT SCREEN, where specs/ui.md has the six sites listed
// with "its name" beside each: one picture carrying all six names, rather than
// the sixth site's build screen. It is evidence and not an assertion — what the
// point decides is the six readings above it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SITE_COUNT, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the six sites in the order the specification lists them", async () => {
  const names: string[] = [];
  for (let index = 0; index < SITE_COUNT; index += 1) {
    await openSite(h, index);
    names.push((await h.snapshot()).site.name);
  }

  await h.debug.setScreen("select");
  await h.advance(1);
  await h.capture("names", "The six site names, in the order they are listed");

  for (const [index, expected] of SITE_NAMES.entries()) {
    assertEqual(
      names[index],
      expected,
      `the name site ${index} carries (specs/sites.md § The site table)`,
    );
  }
});
