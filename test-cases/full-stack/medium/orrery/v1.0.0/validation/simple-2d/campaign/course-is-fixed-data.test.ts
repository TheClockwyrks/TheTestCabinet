// campaign/course-is-fixed-data — the course is the same set, in the same order,
// in every session.
//
// THE RULE. The campaign's challenges are "authored as fixed data in the
// challenge format of `specs/formats.md` and shipped in the build ... the set is
// the same in every session, in a fixed order, numbered from `1`"
// (`specs/modes/campaign.md`, The course). Fixed data is data a session reads
// rather than data a session makes: a course generated at start-up, or shuffled,
// or trimmed by what the player has reached, would not be the same set in the
// next session.
//
// HOW A SECOND SESSION IS REACHED. A harness is one page running the build, so a
// second one is a second session of it — the game standing up again from nothing,
// which is what a reload is. The first session's course is read and the page is
// let go before the second is opened, so the two cannot share anything but the
// build.
//
// WHAT IS COMPARED. The count, and at every index the five fields
// `specs/formats.md` fixes for a challenge document: `name`, `reagents`,
// `products`, `permitted` and `target`. Index for index, so the ORDER is compared
// as well as the membership. Both sides of the comparison are readings off the
// build rather than figures this case wrote down: the course is the build's own
// invention and no sentence of `specs/` says what is in it.
//
// THE VERDICT. The second session's course is the first session's course.

import { it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertNotNull } from "../assert";
import type { Molecule } from "../formats";
import type { PartName } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  type Harness,
} from "../harness";

/** One course entry, as the five fields `specs/formats.md` gives a challenge. */
interface CourseEntry {
  name: string;
  reagents: Molecule[];
  products: Molecule[];
  permitted: PartName[];
  target: number;
}

/** The whole shipped course, in order, read through the editor. */
async function readCourse(h: Harness): Promise<CourseEntry[]> {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");
  const course: CourseEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return course;
    course.push({
      name: view.name,
      reagents: view.reagents,
      products: view.products,
      permitted: view.permitted,
      target: view.target,
    });
  }
  return course;
}

it("reads back the same course in a second session", async () => {
  const first = await createHarness();
  let before: CourseEntry[];
  try {
    before = await readCourse(first);
  } finally {
    await first.dispose();
  }

  const reloaded = await createHarness();
  try {
    const after = await readCourse(reloaded);
    await openSelect(reloaded, "campaign");
    await captureStill(reloaded, "course");

    assertDeepEqual(
      after,
      before,
      "the course is fixed data: the same count, the same order, and the same name, reagents, products, permitted list and target at every index",
    );
  } finally {
    await reloaded.dispose();
  }
});
