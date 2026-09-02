// screens/title-visit-keeps-unlocks-and-solved — a visit to the title throws no
// progress away.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "Reaching `title` discards nothing:
// progress, records, and the per-challenge machines of `specs/editor.md` are
// unchanged by the visit." The progress this point reads is the unlocking and the
// solving: `specs/modes/campaign.md` says both last the session — "A challenge
// stays unlocked, and stays marked solved, for the rest of the session" — and
// `specs/instrumentation.md` says where they are read, as `campaign.unlockedCount`
// and each mode's `solved`, "ascending indices". The records are
// `title-visit-keeps-records`'s point and the stashed machines
// `title-visit-keeps-stashed-machines`'s.
//
// THE CONFIGURATION poses progress that a discard would visibly undo: two
// campaign challenges solved and its unlocked count moved off the `1` a fresh
// session carries, and two Extras solved as well, so a build that kept one mode's
// progress and dropped the other's is caught. `setSolved` and `setUnlockedCount`
// are the surface's own poses of exactly those fields, and the unlocked count is
// posed last so a build that derives it from the solved set is read after both
// are set rather than between them.
//
// BOTH ROUTES THE ITEM NAMES ARE WALKED. The title is reached once from the
// EDITOR, over an open challenge, and once from a SELECT screen, because those
// are the two screens a player leaves for it. `setScreen` "Enters the screen
// `name` ... exactly as the real transition into it enters it", and leaving the
// editor through it "leaves it exactly as leaving it in play does"
// (`specs/instrumentation.md`), so the routes are the played ones. Neither
// `openChallenge` nor the visit is allowed to touch progress: "Neither operation
// touches progress: the unlocked count, the solved sets, the records, the
// per-challenge stashes, and both `last` figures stand as they are."
//
// THE VERDICT. After each arrival at the title, `campaign.unlockedCount` and both
// modes' `solved` lists are exactly what they were before the visit.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  openChallenge,
  openTitle,
  type Harness,
} from "../harness";

/** How many campaign challenges are posed open, away from a fresh session's `1`. */
const UNLOCKED = 3;

/** The campaign rows posed solved, ascending. */
const CAMPAIGN_SOLVED = [0, 1];

/** The Extras rows posed solved, ascending. */
const EXTRAS_SOLVED = [3, 8];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the unlocked count and both solved sets through a visit to the title", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.campaign.count,
    UNLOCKED,
    "the shipped course is long enough to hold the unlocked count this point poses",
  );
  assertGreaterThanOrEqual(
    fresh.extras.count,
    EXTRAS_SOLVED.length === 0 ? 0 : (EXTRAS_SOLVED[EXTRAS_SOLVED.length - 1] ?? 0) + 1,
    "the Extras shelf is long enough to hold the rows this point poses solved",
  );

  for (const index of CAMPAIGN_SOLVED) {
    await h.debug.setSolved("campaign", index, true);
  }
  for (const index of EXTRAS_SOLVED) {
    await h.debug.setSolved("extras", index, true);
  }
  await h.debug.setUnlockedCount(UNLOCKED);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.campaign.unlockedCount,
    UNLOCKED,
    "the unlocked count is posed off the 1 a fresh session carries, so a discard shows",
  );
  assertDeepEqual(
    posed.campaign.solved,
    CAMPAIGN_SOLVED,
    "the campaign rows posed solved are solved before the visit",
  );
  assertDeepEqual(
    posed.extras.solved,
    EXTRAS_SOLVED,
    "the Extras rows posed solved are solved before the visit",
  );

  // The first route: out of the editor, over an open challenge.
  const fromEditor = await captureReplay(h, "progress-kept", async () => {
    await openChallenge(h, "campaign", 0);
    await h.debug.setScreen("title");
    await h.advance(1);
    return h.snapshot();
  });
  assertEqual(
    fromEditor.screen,
    "title",
    "the first visit really reached the title, out of the editor",
  );
  assertEqual(
    fromEditor.campaign.unlockedCount,
    UNLOCKED,
    "reaching the title from the editor discards no unlock",
  );
  assertDeepEqual(
    fromEditor.campaign.solved,
    CAMPAIGN_SOLVED,
    "reaching the title from the editor discards no campaign solve",
  );
  assertDeepEqual(
    fromEditor.extras.solved,
    EXTRAS_SOLVED,
    "reaching the title from the editor discards no Extras solve",
  );

  // The second route: out of a select screen.
  await h.debug.setScreen("select");
  await h.advance(1);
  await h.debug.setScreen("title");
  await h.advance(1);

  const fromSelect = await h.snapshot();
  assertEqual(
    fromSelect.screen,
    "title",
    "the second visit really reached the title, out of a select screen",
  );
  assertEqual(
    fromSelect.campaign.unlockedCount,
    UNLOCKED,
    "reaching the title from a select screen discards no unlock",
  );
  assertDeepEqual(
    fromSelect.campaign.solved,
    CAMPAIGN_SOLVED,
    "reaching the title from a select screen discards no campaign solve",
  );
  assertDeepEqual(
    fromSelect.extras.solved,
    EXTRAS_SOLVED,
    "reaching the title from a select screen discards no Extras solve",
  );
});
