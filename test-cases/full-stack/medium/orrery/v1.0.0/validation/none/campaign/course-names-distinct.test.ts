// campaign/course-names-distinct — no two challenges of the course share a name.
//
// THE RULE. Every challenge of the course "carries a name of its own, distinct
// from every other challenge's in the course" (`specs/modes/campaign.md`, The
// course). The select screen lists "every challenge of the course, in order, each
// row showing its number, its name, and its state", so two rows carrying one name
// leave the player unable to tell which challenge a row is.
//
// THE POSE. Every challenge of the course opened in the editor in turn, where
// `challenge.name` is reported, and then the campaign's select screen, which is
// where the names stand side by side.
//
// THE VERDICT. The course's names hold as many distinct strings as there are
// challenges. The comparison is between the build's own names — the course is the
// build's invention and no sentence of `specs/` says what any of them is — so
// what is decided is only that no two of them are equal.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
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

it("gives every challenge of the course a name of its own", async () => {
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

  assertEqual(
    new Set(names).size,
    names.length,
    `the course's ${names.length} challenges carry ${names.length} distinct names, and these are ${JSON.stringify(names)}`,
  );
});
