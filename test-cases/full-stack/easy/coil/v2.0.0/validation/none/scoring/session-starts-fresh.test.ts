// scoring/session-starts-fresh — a newly loaded game knows nothing of the session
// before it.
//
// specs/scoring.md: "A fresh session starts it at `0`", and both it and
// specs/ui.md put persistence of the score, the best score and any setting
// between sessions out of scope. So a best earned in one session is gone from the
// next, and the next is a genuinely new load rather than a reset: the game is
// loaded a second time in a page of its own, in the same browser context as the
// first — the same origin and the same storage a build could have written the
// figure into — and read before anything touches it.
//
// Reading it after a reset would decide nothing, because
// specs/instrumentation.md has a reset restore the best to `0` whatever the build
// carried across. `states/session.ts` explains the second page in full.
//
// The best of the first session is EARNED rather than posted: the score is posed
// above the best a session opens on and specs/scoring.md then raises the best to
// it, so what the second session is asked to have forgotten really was there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { openFreshSession } from "../states/session";

/** The best the first session reaches. */
const EARNED = 760;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a second session of the same build at a best of zero", async () => {
  await poseScene(h, { score: EARNED, travel: false });
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).best,
    EARNED,
    "the best the first session reached",
  );

  const fresh = await openFreshSession(h);
  try {
    await captureStill({ ...h, page: fresh.page }, "fresh");
    assertEqual(
      fresh.snapshot.screen,
      "title",
      "the screen the second session loaded on",
    );
    assertEqual(
      fresh.snapshot.best,
      0,
      "the best a newly loaded game opens at",
    );
    assertEqual(
      fresh.snapshot.score,
      0,
      "the score a newly loaded game opens at",
    );
  } finally {
    await fresh.page.close().catch(() => undefined);
  }
});
