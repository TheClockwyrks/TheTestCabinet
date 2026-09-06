// instrumentation/open-challenge-opens-the-editor — `openChallenge` opens a
// shipped challenge in the editor.
//
// THE RULE. "`openChallenge(mode, index)` — The open challenge becomes that
// mode's shipped challenge at `index`, and the game moves to the editor ... The
// snapshot reports it under that `mode` and `index`"
// (`specs/instrumentation.md`, The challenge). The snapshot carries the open
// challenge as `challenge`, with `source: "campaign" | "extras" | "custom"` and
// `index: <number | null>`, and `null` "away from the editor".
//
// THE HEADING IS WHERE THE EDITOR NAMES IT (`specs/editor.md`, Layout):
// "Heading — `x` `0` to `STAGE_W` (`1280`), `y` `0` to `HEADING_H` (`48`) — The
// challenge's name, the machine's current cost, and the editor's messages." The
// name is read off the logical runs drawn there (`textRunsIn`), never off the
// `fillText` split: a build that letter-spaces its heading draws one glyph per
// call, and the name is still the name.
//
// WHICH CHALLENGE IS "AT `index`" IS DECIDED WITHOUT A FIXED LIST. Both courses
// carry distinct names — `specs/modes/campaign.md` requires each course challenge
// to carry "a name of its own, distinct from every other challenge's in the
// course", and `specs/challenges.md` is authoritative for the ten Extras, whose
// names all differ — so opening two indices and then the first one again
// distinguishes "the challenge at that index" from "some challenge" without
// holding the build's own course against a list, which is another item's business.
//
// THE CONFIGURATION. A reset session. Two Extras indices are opened in turn and
// then the first is opened again, and one campaign index is opened after them.
// Nothing else is posed: no machine is built, no run is started, and no progress
// is touched.
//
// THE VERDICT. Each call leaves the game on the editor screen with a challenge
// open, reported under the mode and the index asked for; the two indices open
// challenges with different names and re-opening the first brings its own name
// back; and the frame drawn over it writes that name in the heading.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertMatches,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import { NAME_MAX } from "../constants";
import { HEADING_REGION } from "../field";
import {
  captureStill,
  createHarness,
  openChallenge,
  openTitle,
  textRunsIn,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens that mode's challenge at that index, in the editor, under its name", async () => {
  await openTitle(h);

  await openChallenge(h, "extras", 6);
  const first = (await h.snapshot()).challenge;
  assertNotNull(first, "openChallenge(extras, 6) leaves a challenge open");
  const name = first?.name ?? "";
  assertMatches(
    name,
    /^.{1,32}$/su,
    `a challenge's name is 1 to NAME_MAX (${NAME_MAX}) characters`,
  );

  await openChallenge(h, "extras", 8);
  const other = (await h.snapshot()).challenge;
  assertNotNull(other, "openChallenge(extras, 8) leaves a challenge open");
  assertNotEqual(
    other?.name,
    name,
    "two Extras indices open two challenges, whose names differ",
  );

  await openChallenge(h, "extras", 6);
  await captureStill(h, "opened");
  const again = await h.snapshot();
  const calls = await h.lastCalls();

  assertEqual(
    again.screen,
    "editor",
    "openChallenge moves the game to the editor",
  );
  assertEqual(
    again.challenge?.source,
    "extras",
    "the snapshot reports the open challenge under the mode asked for",
  );
  assertEqual(again.challenge?.index, 6, "and under the index asked for");
  assertEqual(
    again.challenge?.name,
    name,
    "index 6 opens the same challenge every time, rather than the one opened last",
  );
  const heading = textRunsIn(calls, HEADING_REGION)
    .map((draw) => draw.text)
    .join(" ")
    .toLowerCase();
  assertMatches(
    heading,
    name.toLowerCase(),
    "the editor's heading shows the open challenge's name",
  );

  await openChallenge(h, "campaign", 2);
  const campaign = await h.snapshot();
  assertEqual(
    campaign.screen,
    "editor",
    "a campaign challenge opens the editor the same way",
  );
  assertEqual(
    campaign.challenge?.source,
    "campaign",
    "reported under the campaign",
  );
  assertEqual(campaign.challenge?.index, 2, "and under its own index");
});
