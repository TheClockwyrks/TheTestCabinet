// screens/how-to-play-copy-the-loop — the how-to screen covers the dig-sell-upgrade loop.
//
// specs/ui.md lists eleven subjects the `how-to-play` screen has to cover, and
// this point decides the loop alone: digging, selling, and upgrading.
//
// THE OTHER FIVE GROUPS ARE THEIR OWN POINTS. One point asserting all eleven
// could only fail once, so a build missing one line of the briefing would be
// docked exactly as much as one missing every line.
//
// HOW EACH SUBJECT IS READ WITHOUT FIXING THE WORDS is `screens/how-to-play-subjects`,
// which carries the terms this case's own specification names for each of them.
//
// ISOLATION. The screen reached directly through the surface rather than through
// the title, because a build with a broken title menu and correct copy must pass
// this and fail `screens/how-to-play-reachable`.

import { afterEach, beforeEach, it } from "vitest";
import { assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnCopy } from "./frames";
import { LOOP } from "./how-to-play-subjects";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers the dig-sell-upgrade loop", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.reset();
  await h.debug.setScreen("how-to-play");

  const calls = await h.frameCalls();
  await captureStill(h, "copy");
  const copy = drawnCopy(calls);

  for (const [subject, names] of LOOP) {
    assertMatches(
      copy,
      names,
      `specs/ui.md: the how-to-play screen covers ${subject}`,
    );
  }
});
