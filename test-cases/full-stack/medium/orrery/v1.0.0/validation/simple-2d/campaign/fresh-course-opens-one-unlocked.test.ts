// campaign/fresh-course-opens-one-unlocked — a build that has just loaded opens
// the course on challenge 1 and nothing else.
//
// THE RULE. "Challenge `1` is unlocked from the start. Every other challenge
// begins locked" (`specs/modes/campaign.md`, Progression). The snapshot carries
// that as one number — "`campaign.unlockedCount`" is "how many are open"
// (`specs/instrumentation.md`, Snapshot shape) — and the resting-value table names
// its value outright: "`campaign.unlockedCount` | `1`". So "every other challenge
// is locked" and "the count is `1`" are one reading, not two, and reading the
// count is what decides both.
//
// THE WORLD IS THE ONE THE BUILD LOADED WITH. Nothing is posed before the reading:
// the harness stands the build up and the very first thing asked of it is
// `snapshot()`, "A pure read of the state ... It changes nothing"
// (`specs/instrumentation.md`). No `reset()` runs, because `reset` is the
// operation that RESTORES this value, and a check that called it would decide
// whether `reset` works rather than whether a fresh session opens right. That is
// `reset`'s own item; this one is about the session the player actually gets.
//
// THE VERDICT. `campaign.unlockedCount` is `1` on the freshly loaded build.
//
// THE EVIDENCE is taken after the reading, never before it: the campaign select
// screen, where the one open row and the locked rest are what a player sees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("opens a freshly loaded course with exactly one challenge unlocked", async () => {
  const fresh = await h.snapshot();

  await openSelect(h, "campaign");
  await captureStill(h, "fresh");

  assertEqual(
    fresh.campaign.unlockedCount,
    1,
    "challenge 1 is unlocked from the start and every other challenge begins " +
      "locked, so a freshly loaded build reports an unlocked count of 1",
  );
});
