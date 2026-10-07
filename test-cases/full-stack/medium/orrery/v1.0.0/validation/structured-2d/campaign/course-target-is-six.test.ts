// campaign/course-target-is-six — every challenge of the course asks for six
// constellations.
//
// THE RULE. "`target` is the tally every set must reach, at least `1`. Every
// challenge in this game uses `CONSTELLATION_TARGET` (`6`)"
// (`specs/formats.md`, Challenges). The campaign's challenges are challenge
// documents like any other — "authored as fixed data in the challenge format of
// `specs/formats.md`" (`specs/modes/campaign.md`) — so the sentence binds the
// build's own course as much as it binds the fixed Extras.
//
// THE POSE. Each challenge of the course opened in the editor in turn, which is
// where `challenge.target` is reported. `openChallenge` "opens that mode's
// shipped challenge at `index`" and "a locked row opens like any other"
// (`specs/instrumentation.md`), so the whole course is readable from a fresh
// session with nothing unlocked.
//
// THE VERDICT. Every challenge of the course reports `target`
// `CONSTELLATION_TARGET`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("asks for CONSTELLATION_TARGET constellations in every challenge", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    await captureStill(h, "challenge");

    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    assertEqual(
      view?.target,
      CONSTELLATION_TARGET,
      `campaign challenge ${index + 1} asks for CONSTELLATION_TARGET constellations`,
    );
  }
});
