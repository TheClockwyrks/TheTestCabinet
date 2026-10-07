// campaign/progress-lasts-the-session — a detour through the Extras leaves the
// course's progress standing.
//
// THE RULE. "A challenge stays unlocked, and stays marked solved, FOR THE REST OF
// THE SESSION" (`specs/modes/campaign.md`, Progression) — for the rest of it,
// rather than for as long as the game stays in campaign mode. `setMode(mode)`
// "Sets the course the select and editor screens serve"
// (`specs/instrumentation.md`), which is a change of what is SHOWN and nothing
// more; the two modes keep their own progress side by side in the snapshot, as
// `campaign` and `extras`. `specs/ui.md` says it again of the screen the detour
// goes through: "Reaching `title` discards nothing: progress, records, and the
// per-challenge machines of `specs/editor.md` are unchanged by the visit."
//
// THE WORLD. Progress is posed rather than played, because what this point is about
// is what SURVIVES rather than what writes it: `setUnlockedCount` opens the first
// two challenges and `setSolved` marks the first. Then the detour — the mode set to
// extras, its select screen entered as the real transition enters it, the mode set
// back to campaign — and the same two figures are read again.
//
// THE VERDICT. `campaign.unlockedCount` and `campaign.solved` are exactly what they
// were before the detour.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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

it("keeps the unlocked count and the solved set across a visit to the Extras", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    1,
    "the course holds a second challenge, so an unlocked count of 2 is a " +
      "figure the detour could be seen to change",
  );
  await h.debug.setUnlockedCount(2);
  await h.debug.setSolved("campaign", 0, true);
  const stood = (await h.snapshot()).campaign;

  await h.debug.setMode("extras");
  await h.debug.setScreen("select");
  await h.advance(1);
  await h.debug.setMode("campaign");

  await openSelect(h, "campaign");
  await captureStill(h, "persisted");

  const after = (await h.snapshot()).campaign;
  assertEqual(
    after.unlockedCount,
    stood.unlockedCount,
    "the course's unlocked count lasts the session, so serving the Extras and " +
      "coming back leaves it where it stood",
  );
  assertDeepEqual(
    after.solved,
    stood.solved,
    "the course's solved set lasts the session, so serving the Extras and " +
      "coming back leaves it where it stood",
  );
});
