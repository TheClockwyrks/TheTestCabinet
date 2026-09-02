// screens/solved-omits-next-on-last-challenge — the mode's last challenge gets a
// panel with no NEXT CHALLENGE on it.
//
// THE RULE is the sentence after the menu's own in `specs/ui.md`, The solved
// panel: the menu is "built from `SOLVED_ITEMS` (`NEXT CHALLENGE`,
// `KEEP TINKERING`, `BACK TO SELECT`, in that order). `NEXT CHALLENGE` is offered
// ONLY WHEN THE MODE HAS A CHALLENGE AFTER THIS ONE; THE MENU IS OTHERWISE THE
// REMAINING TWO ITEMS IN THE SAME ORDER." This point decides the side where there
// is no challenge after: two items, `KEEP TINKERING` then `BACK TO SELECT`. The
// other side is `solved-offers-next-challenge`.
//
// THE CONFIGURATION is the LAST Extra. "The Extras hold exactly `EXTRA_COUNT`
// (`10`) challenges, numbered `1` through `10`" (`specs/modes/extras.md`), so the
// shelf's last index is `EXTRA_COUNT - 1` whatever else the build ships, and
// `specs/challenges.md` is authoritative for it. The campaign is not used, because
// its length is the build's own choice within `CAMPAIGN_MIN` and `CAMPAIGN_MAX`
// while the shelf's is fixed.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`). The last
// Extra's product repeats, so its set's footprint is "the pattern plus, when the
// product repeats, the pattern translated once by the repeat vector"
// (`specs/parts.md`) — two hexes from the origin, comfortably on the field.
//
// HOW THE TEXT IS READ. Nothing in `specs/` says how a string reaches the canvas,
// and letter spacing is not portable, so a build is free to draw one entry as one
// call, as a call per word, or as a call per glyph. What all of those share is
// the baseline: one entry is drawn at one `y`, and stacked entries at different
// ones. So the frame's text runs are gathered by the `y` their anchor maps to and
// joined in `x` order.
//
// THE VERDICT. The frame that carries the panel draws `KEEP TINKERING` and, below
// it, `BACK TO SELECT`, and draws `NEXT CHALLENGE` nowhere at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { EXTRA_COUNT, SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The Extra this check completes: the shelf's last, which holds nothing after. */
const INDEX = EXTRA_COUNT - 1;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The entry withheld here, and the two that remain, in SOLVED_ITEMS order. */
const [NEXT, KEEP, BACK] = SOLVED_ITEMS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
}

/** The frame's text runs, gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  return [...baselines.entries()]
    .map(([y, on]) => ({
      y,
      text: [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(""),
    }))
    .sort((a, b) => a.y - b.y);
}

/** The topmost line the frame drew `text` on, or `null` when it drew it on none. */
function lineWith(lines: readonly Line[], text: string): Line | null {
  const wanted = text.trim().toLowerCase();
  return lines.find((line) => line.text.toLowerCase().includes(wanted)) ?? null;
}

it("leaves KEEP TINKERING then BACK TO SELECT, and no NEXT CHALLENGE, on the shelf's last challenge", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "two-items");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    shown.challenge?.source,
    "extras",
    "the completed challenge belongs to the Extras, so the mode's shelf decides its menu",
  );
  assertEqual(
    shown.challenge?.index,
    INDEX,
    "and it is the shelf's last challenge, the one the mode holds nothing after",
  );

  assertEqual(
    lineWith(lines, NEXT as string),
    null,
    `the mode has no challenge after this one, so the panel never offers ${String(NEXT)}`,
  );

  const keep = lineWith(lines, KEEP as string);
  const back = lineWith(lines, BACK as string);
  assertNotNull(keep, `the menu is the remaining two items, so it draws ${String(KEEP)}`);
  assertNotNull(back, `and it draws ${String(BACK)}`);
  assertGreaterThan(
    back?.y ?? Number.NEGATIVE_INFINITY,
    keep?.y ?? Number.POSITIVE_INFINITY,
    `the remaining two are in the same order, so ${String(BACK)} is drawn under ${String(KEEP)}`,
  );
});
