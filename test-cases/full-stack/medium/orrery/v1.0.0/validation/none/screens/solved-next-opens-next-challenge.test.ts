// screens/solved-next-opens-next-challenge — taking NEXT CHALLENGE opens the
// mode's next challenge in the editor.
//
// THE RULE is the first row of the solved panel's `confirm` table in
// `specs/ui.md`, The solved panel: "`NEXT CHALLENGE` | Opens the next challenge
// of the mode in the editor." Which item `confirm` takes is the sentence above
// it: "`state.menuIndex` is `0` on arriving, `up` and `down` move it with
// wrapping, and `confirm` takes the item", and `NEXT CHALLENGE` is the first
// entry of `SOLVED_ITEMS`, offered here because "the mode has a challenge after
// this one". `specs/controls.md` grants the press: the "`editor`, `faulted` or
// `complete`" row of What each screen reads carries "`up`, `down`, and `confirm`
// while the solved panel of `specs/ui.md` is up".
//
// THE CONFIGURATION is the FIRST Extra, completed. "The Extras hold exactly
// `EXTRA_COUNT` (`10`) challenges, numbered `1` through `10`"
// (`specs/modes/extras.md`) and `specs/challenges.md` is authoritative for every
// one of them, so the challenge after index `0` is index `1`, "Twin Moons", and
// the check knows its name without asking the build. The campaign is not used,
// because its challenges are the build's own invention.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`). The highlight
// is posed to `0` through the surface and read back, so the item `confirm` takes
// is `NEXT CHALLENGE` and not whichever item the arrival happened to leave.
//
// THE VERDICT. `screen` is `editor`, and the challenge open on it is the Extras'
// index `1` — reported under that mode and index, and carrying the name
// `specs/challenges.md` gives it. A build that reopened the challenge just
// finished, or that went to the select screen, fails on the index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  pressAction,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** Where NEXT CHALLENGE sits: the first entry of SOLVED_ITEMS. */
const NEXT_ITEM = 0;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the Extras' next challenge in the editor on confirm", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.debug.setMenuIndex(NEXT_ITEM);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.menuIndex,
    NEXT_ITEM,
    `the highlight stands on ${String(SOLVED_ITEMS[NEXT_ITEM])}, the first entry of SOLVED_ITEMS`,
  );

  await captureReplay(h, "next", async () => {
    await pressAction(h, "confirm");
    await h.advance(1);
  });

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "editor",
    "NEXT CHALLENGE opens the next challenge of the mode IN THE EDITOR",
  );
  assertNotNull(opened.challenge, "a challenge is open on it");
  assertEqual(
    opened.challenge?.source,
    "extras",
    "the challenge it opened belongs to the same mode",
  );
  assertEqual(
    opened.challenge?.index,
    INDEX + 1,
    "and it is the challenge after the one just completed",
  );
  assertEqual(
    opened.challenge?.name,
    extra(INDEX + 1).name,
    "which specs/challenges.md names, and is authoritative for",
  );
});
