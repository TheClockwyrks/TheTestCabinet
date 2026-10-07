// instrumentation/load-challenge-reports-a-custom-source — a loaded challenge
// reports a custom source.
//
// THE RULE. "`loadChallenge(challenge)` — ... The snapshot reports its `source`
// as `"custom"`" (`specs/instrumentation.md`, The challenge), against
// `openChallenge`, whose challenge "the snapshot reports ... under that `mode`
// and `index`". The snapshot shape fixes the pair: `source: "campaign" |
// "extras" | "custom"` and `index: <number | null>, // null when source is
// "custom"`.
//
// WHY THE SOURCE IS CARRIED AT ALL is the sentence that follows: "Completing a
// challenge whose source is `"custom"` touches no progress and no record" — so
// the field is what tells a shipped challenge's completion from a loaded one's.
//
// THE CONFIGURATION. A reset session, in which one shipped challenge is opened
// from each mode and one document is loaded, in that order and then in the other,
// so the reading is what the LAST operation left rather than whatever was set
// first. The document is this project's own, authored against `specs/formats.md`.
// Nothing is placed and no run is started.
//
// THE VERDICT. A challenge opened by `openChallenge` reports its own mode and its
// own index; a challenge posed by `loadChallenge` reports `"custom"`, with `index`
// `null` rather than the index of the challenge that was open before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { PAIRED } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallenge,
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

it("reports custom with a null index for a loaded document, and the mode and index for a shipped one", async () => {
  await openTitle(h);

  await openChallenge(h, "extras", 4);
  const shipped = (await h.snapshot()).challenge;
  assertNotNull(shipped, "the shipped challenge is open");
  assertEqual(
    shipped?.source,
    "extras",
    "a challenge openChallenge opened reports the mode it was asked for",
  );
  assertEqual(shipped?.index, 4, "and the index it was asked for");

  await h.debug.loadChallenge(PAIRED);
  await h.debug.setScreen("editor");
  await h.advance(1);
  await captureStill(h, "source");
  const loaded = (await h.snapshot()).challenge;
  assertNotNull(loaded, "the loaded document is open");
  assertEqual(
    loaded?.source,
    "custom",
    "a challenge loadChallenge posed reports a custom source",
  );
  assertNull(
    loaded?.index ?? null,
    "and no index, rather than the index of the challenge open before it",
  );

  await openChallenge(h, "campaign", 0);
  const campaign = (await h.snapshot()).challenge;
  assertNotNull(
    campaign,
    "a shipped challenge opened after a custom one is open",
  );
  assertEqual(
    campaign?.source,
    "campaign",
    "and reports its own mode rather than staying custom",
  );
  assertEqual(campaign?.index, 0, "and its own index rather than staying null");
});
