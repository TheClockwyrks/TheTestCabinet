// screens/title-is-the-opening-screen — the game opens on `title`, highlight at
// `0`.
//
// `specs/ui.md` § The screens, Title: "The game opens on `title`, showing
// `TITLE_TEXT` (`GANTRY`) ... with `menuIndex` `0` on arriving."
//
// WHAT "OPENS ON" MEANS, AND WHY A SNAPSHOT TAKEN NOW WOULD NOT DECIDE IT. Every
// check in this project runs after the harness's opening `reset`, and a `reset`
// puts the game back on "the `title` screen with `menuIndex` `0`"
// (`specs/instrumentation.md`) — so a build that stood the game up on any screen
// at all and implemented `reset` correctly would read `title` here. The reading
// that decides the requirement is the one taken BEFORE that reset, which is what
// `h.openingSnapshot` holds: the state the build itself stood the game up in, off
// its own boot path, with nothing posed.
//
// Both halves of one sentence are read, because "opens on `title`" and "with
// `menuIndex` `0` on arriving" describe one arrival: a title screen highlighting
// nothing in particular has not arrived the way the specification says it does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the game up on the title screen with the first entry highlighted", async () => {
  const opening = h.openingSnapshot;
  assertNotNull(
    opening,
    "a snapshot off the build as it stood itself up, before anything was posed",
  );

  assertEqual(
    opening!.screen,
    "title",
    "the screen the game opens on (specs/ui.md)",
  );
  assertEqual(
    opening!.menuIndex,
    0,
    "the highlighted title entry on arriving (specs/ui.md)",
  );

  await h.debug.reset();
  await h.advance(1);
  await h.capture("title", "The screen the game opens on");
});
