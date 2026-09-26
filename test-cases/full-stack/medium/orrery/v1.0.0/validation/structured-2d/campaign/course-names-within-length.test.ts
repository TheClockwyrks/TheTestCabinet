// campaign/course-names-within-length — every challenge of the course carries a
// name of a legal length.
//
// THE RULE. "`name` is the challenge's display name, `1` to `NAME_MAX` (`32`)
// characters" (`specs/formats.md`, Challenges), and every challenge of the
// campaign "is well formed under `specs/formats.md` and carries a name of its
// own" (`specs/modes/campaign.md`, The course). A name is what the select screen
// draws in a row, so an empty one leaves a row unlabelled and an overlong one has
// nowhere to fit.
//
// THE POSE. Every challenge of the course opened in the editor in turn, where
// `challenge.name` is reported, and then the campaign's select screen, which is
// where the whole course's names are drawn together.
//
// THE VERDICT. Every name's length is at least `1` and at most `NAME_MAX`. The
// length is counted in characters, as the specification counts it, and nothing
// here reads what any name SAYS: the course is the build's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan, assertNotNull } from "../assert";
import { NAME_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names every challenge in 1 to NAME_MAX characters", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    names.push(view === null ? "" : view.name);
  }

  await openSelect(h, "campaign");
  await captureStill(h, "names");

  for (const [index, name] of names.entries()) {
    assertBetween(
      name.length,
      1,
      NAME_MAX,
      `campaign challenge ${index + 1}'s name runs 1 to NAME_MAX characters`,
    );
  }
});
