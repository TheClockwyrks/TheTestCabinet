// instrumentation/set-screen-editor-throws-without-a-challenge — the editor has
// nothing to show without a challenge, and the call says so.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress, in the table of
// what each name does: "`editor` | Shows the editor over the open challenge,
// leaving the machine, both histories, and any live run as they stand. With no
// challenge open it throws." The same file states the principle the row applies:
// "An argument outside the domain its operation states is invalid, and the call
// fails loudly rather than guessing what was meant."
//
// THE CONFIGURATION. Three screens on which no challenge is open, reached the way
// a session reaches them: a reset, which leaves "the title screen... no challenge
// open"; the how-to; and a select screen. `challenge` is read first on each, so
// the check knows the refusal it is about to ask for is the one the rule names,
// rather than a call that happened to fail for some other reason.
//
// WHY THE SCREEN IS READ AFTERWARDS. A call that "fails loudly" changes nothing:
// a build that threw AND moved to a blank editor would have obeyed the letter of
// the row and left the session somewhere the specification does not allow, so each
// refusal is followed by a reading that the screen is the one the call was made
// from.
//
// THE VERDICT. Every one of the three calls throws, and every one of them leaves
// the screen exactly where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import type { ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Call `setScreen("editor")` and say whether it threw. */
async function refused(): Promise<string> {
  try {
    await h.debug.setScreen("editor");
  } catch {
    return "threw";
  }
  return "returned";
}

it("throws on every screen that has no challenge open, and moves nothing", async () => {
  const screens: {
    name: string;
    screen: ScreenName;
    open: () => Promise<void>;
  }[] = [
    { name: "the title", screen: "title", open: () => openTitle(h) },
    { name: "the how-to", screen: "howto", open: () => openHowto(h) },
    {
      name: "the select screen",
      screen: "select",
      open: () => openSelect(h, "campaign"),
    },
  ];

  for (const where of screens) {
    await where.open();

    const standing = await h.snapshot();
    assertEqual(
      standing.screen,
      where.screen,
      `the session is on ${where.name}`,
    );
    assertNull(standing.challenge, `no challenge is open on ${where.name}`);

    const outcome = await refused();
    await h.advance(1);
    if (where.screen === "title") await captureStill(h, "refused");
    assertEqual(
      outcome,
      "threw",
      `setScreen("editor") throws on ${where.name}, where no challenge is open`,
    );

    const after = await h.snapshot();
    assertEqual(
      after.screen,
      where.screen,
      `the refused call left the session on ${where.name}`,
    );
    assertNull(
      after.challenge,
      `the refused call opened no challenge on ${where.name}`,
    );
  }
});
