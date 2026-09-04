// screens/check-display-unstable-colors-no-member — with the structure does not stand, the check
// colours no member.
//
// `specs/ui.md` § Build fixes what the check shows for each of its three
// outcomes. With no readiness issue and a structure that does not stand: "the check
// reports no member" — "the check reports no member, SO NOTHING IS COLORED".
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

it("colours no member when the structure does not stand", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  // A crane whose members do not hold it up: the check finds no readiness issue
  // and the solve does not stand (`specs/structure.md`).
  await h.debug.setRing(0, 2, 0);
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "cable");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "cable");
  await h.debug.addMember(0, 2, 0, 2, 2, 0, "rail");

  const found = await h.check();
  assertTrue(
    !found.stable,
    "a structure that does not stand, which is the outcome this check is about",
  );

  await h.advance(1);

  const members = entriesOf(await h.drawn(), "member", "cable");

  await h.capture("check-unstable-color", "The check on a structure that does not stand");

  assertEqual(
    found.members.length,
    0,
    "members the check reports, which is none in this outcome (specs/ui.md)",
  );
  assertTrue(
    members.length >= 2,
    `at least two cables drawn, so their colours can be compared — the frame ` +
      `drew ${members.length}`,
  );
  for (const member of members.slice(1)) {
    const apart = colourDistance(members[0]!.color, member.color);
    assertTrue(
      apart <= TOGETHER,
      `every cable to be drawn alike when nothing is coloured by utilization ` +
        `— two of them stand ${apart} of 765 apart (specs/ui.md)`,
    );
  }
});
