// screens/solved-panel-draws-title-text — the solved panel is headed
// `SOLVED_TITLE_TEXT`.
//
// THE RULE. "While `sim.status` is `complete`, a panel is drawn over the run
// showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`)" (`specs/ui.md`, The solved
// panel), and the file's own preamble fixes the words: "Every figure and every
// piece of screen copy below carries the name this specification gives it." So
// the heading is that string and not a wording of the build's own — unlike the
// fault banner two sections later, whose "wording is the build's own". This point
// decides the HEADING; that the panel is up while the run is complete at all is
// `solved-panel-appears-on-complete`'s, and the metrics, the records and the menu
// under the heading are each their own item.
//
// THE COPY IS READ AS TEXT, because that is how `specs/assets.md` puts it on the
// stage: under What stays drawn in code, "The title, howto, and select screens,
// the solved panel, and all text" are drawn by the build, and "Every word the
// game puts on the stage is drawn as text ... rather than as shapes traced into
// the form of letters or assembled from images of glyphs". The heading is read
// with the shared harness's `drewText`, which gathers the frame's logical runs
// onto the baselines they share, so a heading drawn as one run and a heading
// drawn word by word read alike, and which ignores spacing and case, which
// `specs/ui.md` fixes no more than it fixes a palette or a font.
//
// THE POSE. A challenge asking for ONE delivery of a lone `sol`, with one `set`
// standing alone on the field and a lone `sol` spawned on its footprint. One
// cycle later the set has taken it, the tally has reached the challenge's
// `target` of `1`, and the run is `complete` — which is the only status this
// panel is drawn in. Nothing else is on the field, so nothing else is drawing
// text over the run.
//
// THE VERDICT. The frame drawn over the completed run shows `CHALLENGE COMPLETE`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { drawnTextLines, drewText } from "../case-harness/text";
import { SOLVED_TITLE_TEXT } from "../constants";
import { setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openRun,
  spawnMote,
  type Harness,
} from "../harness";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws SOLVED_TITLE_TEXT over the completed run", async () => {
  await openRun(h, { challenge: ONE_DELIVERY, machine: ONE_SET });
  await spawnMote(h, ORIGIN, "sol");
  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  await captureStill(h, "heading");

  const after = await h.snapshot();
  assertNotNull(
    after.sim,
    "the run is still reported at the completing boundary",
  );
  assertEqual(
    after.sim?.status,
    "complete",
    "the set takes the sol resting on it, the tally reaches the challenge's " +
      "target of 1, and the run completes, which is the status the panel is up in",
  );

  assertTrue(
    drewText(calls, SOLVED_TITLE_TEXT),
    `the solved panel is headed ${JSON.stringify(SOLVED_TITLE_TEXT)}, and the ` +
      `text the frame drew is ${JSON.stringify(drawnTextLines(calls))}`,
  );
});
