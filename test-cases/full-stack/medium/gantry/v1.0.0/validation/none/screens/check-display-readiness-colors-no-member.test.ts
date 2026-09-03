// screens/check-display-readiness-colors-no-member — with a readiness issue, the check
// colours no member.
//
// `specs/ui.md` § Build fixes what the check shows for each of its three
// outcomes. With a readiness issue: "The issues by name, and no verdict: with a
// readiness issue the structure is not solved" — "the check reports no member, SO NOTHING IS COLORED".
//
// COLOURED MEANS COLOURED BY UTILIZATION. A member is drawn whatever the check
// found — the screen still shows "the structure as built" — so what must be
// absent is the ramp, not the members. `specs/overview.md` has the ramp read a
// member's utilization, and `check()` reports no member at all here, so a build
// that coloured one would be colouring by a figure it does not have.
//
// THE READING IS THE COLOURS THE FRAME REPORTS. Every member is drawn in its
// material's own colour, so they agree with each other; a ramp would spread them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  colourDistance,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** How far two members of one material may be drawn apart, out of 765. */
const TOGETHER = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("colours no member when a readiness issue", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  // Two struts and no ring: `no-ring` is a readiness issue
  // (`specs/structure.md`), so the check does not solve the structure.
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut");

  const found = await h.check();
  assertTrue(
    found.issues.length > 0,
    "a readiness issue, which is the outcome this check is about",
  );

  await h.advance(1);

  const members = entriesOf(await h.drawn(), "member", "strut");

  await h.capture("check-no-color", "The check with a readiness issue");

  assertEqual(
    found.members.length,
    0,
    "members the check reports, which is none in this outcome (specs/ui.md)",
  );
  assertTrue(
    members.length >= 2,
    `at least two struts drawn, so their colours can be compared — the frame ` +
      `drew ${members.length}`,
  );
  for (const member of members.slice(1)) {
    const apart = colourDistance(members[0]!.color, member.color);
    assertTrue(
      apart <= TOGETHER,
      `every strut to be drawn alike when nothing is coloured by utilization ` +
        `— two of them stand ${apart} of 765 apart (specs/ui.md)`,
    );
  }
});
