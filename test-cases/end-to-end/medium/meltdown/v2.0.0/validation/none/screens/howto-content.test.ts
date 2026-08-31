// Meltdown — screens/howto-content: the how-to screen covers the game.
//
// THE RULE. `specs/screens.md`, on `howto`: it "Covers the goal of the game, the
// controls, heat as power and the redline trip, the Forge and the Sink, the
// heat-averse Rime, flyers and the air-only Flak, that a Containment wave fields a
// single type, and the economy."
//
// WHAT IS DECIDED, AND WHAT IS THE REVIEWER'S. Whether the prose actually TEACHES
// the game is a reading no script can make, and the captured still is what the
// reviewer makes it on. What a script can decide is that the screen carries a body
// of text at all and that each subject on that list is NAMED in it — which is
// exactly the half a build fails, because a how-to screen that is empty, or that
// covers three of the nine subjects, is the failure this item exists to catch.
//
// EACH SUBJECT IS ASSERTED SEPARATELY, so a build whose how-to never mentions the
// Sink fails with that subject named rather than with "the how-to is thin".
//
// HOW A SUBJECT IS LOOKED FOR, AND WHY IT IS AN ALTERNATION. The case's own
// vocabulary is what a subject is looked for by: `specs/towers.md` names the
// Forge, the Sink, the Rime and the Flak, `specs/surge.md` the Drift,
// `specs/heat.md` the redline and the trip, `specs/economy.md` the money, the
// bounty and the interest. Those are the case's words and a build teaching the
// game uses them. But `specs/screens.md` fixes not one word of this screen, so
// where a subject has more than one honest name — a flyer may be called the Drift,
// or a flyer, or air — every one of them is accepted, and a subject is named when
// ANY of its words appears. The alternations are deliberately generous: a check
// this loose still fails a screen that never raised the subject, and a tighter one
// would grade a build's prose style.
//
// MATCHED AS WHOLE WORDS, not as substrings, because a substring match is how a
// check accidentally passes: `HEAT` sits inside `HEATED`, which is fine, but a
// screen reading `WAVEFORM` has not named a wave and `AIRLOCK` has not named a
// flyer. `drewWord` matches at the boundaries either side.
//
// THE LETTER FLOOR IS NOT A SUBJECT CHECK, and it is not redundant with one.
// Eleven words could be drawn as eleven words: the floor is what says the screen
// carries PROSE rather than a word list. `HOWTO_MIN_LETTERS` is set at `120`,
// which is the eleven words this check looks for plus about the same again — far
// under anything that covers nine subjects in sentences, and far over a bare list.
//
// THE SCREEN IS POSED, because what it DRAWS does not depend on how a player got
// to it: reaching it is `screens.title-to-howto`'s reading and leaving it is
// `screens.back-from-howto`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drewWord,
  type Harness,
  type DrawCall,
} from "../harness";
import { lettersIn } from "./copy";

/**
 * How many letters the how-to screen must carry.
 *
 * `specs/screens.md` gives it nine subjects and fixes no wording, so the floor has
 * to sit below the tersest honest screen and above what a build that wrote no
 * prose can produce. The eleven words this check looks for come to about sixty
 * letters; `120` is twice that, which nine subjects cannot be covered in without
 * sentences, and a fraction of what any real how-to draws.
 */
const HOWTO_MIN_LETTERS = 120;

/**
 * Each subject `specs/screens.md` puts on this screen, and every word of the
 * case's own vocabulary that names it.
 *
 * A subject is named when any one of its words is drawn. Where the case fixes a
 * proper noun — the four towers and the flyer — that noun leads the list, and the
 * plainer words beside it are there because no specification takes them away from
 * a build.
 */
const SUBJECTS: readonly { subject: string; words: readonly string[] }[] = [
  // "the goal of the game": the surge crosses to its exhaust, a leak costs lives,
  // and the last wave cleared contains it (`specs/surge.md`, `specs/waves.md`).
  {
    subject: "the goal of the game",
    words: ["LIVES", "LIFE", "LEAK", "LEAKS", "EXHAUST", "SURVIVE", "CONTAIN"],
  },
  // "heat as power": an emitter fires harder the hotter it runs (`specs/heat.md`).
  { subject: "heat as power", words: ["HEAT", "HOT", "HOTTER", "THERMAL"] },
  // "the redline trip": the crossing at `TRIP_HEAT` (`specs/heat.md`).
  {
    subject: "the redline trip",
    words: ["REDLINE", "TRIP", "TRIPS", "TRIPPED", "TRIPPING"],
  },
  // The two movers, by the names `specs/towers.md` gives them.
  { subject: "the Forge", words: ["FORGE"] },
  { subject: "the Sink", words: ["SINK"] },
  // The heat-averse emitter and the air-only one, likewise.
  { subject: "the Rime", words: ["RIME"] },
  { subject: "the Flak", words: ["FLAK"] },
  // "flyers": the Drift is the one type that flies (`specs/surge.md`).
  {
    subject: "flyers",
    words: [
      "DRIFT",
      "FLY",
      "FLIES",
      "FLYING",
      "FLYER",
      "FLYERS",
      "AIR",
      "AIRBORNE",
    ],
  },
  // "that a Containment wave fields a single type" (`specs/waves.md`). The
  // weakest anchor of the ten, because any screen covering this game says `wave`
  // somewhere; it is asserted anyway, since a how-to that never names a wave has
  // certainly not covered what one fields.
  { subject: "the waves", words: ["WAVE", "WAVES", "ONSLAUGHT"] },
  // "the economy": the four income lines of `specs/economy.md`.
  {
    subject: "the economy",
    words: ["MONEY", "INTEREST", "BOUNTY", "BOUNTIES", "CASH", "EARN"],
  },
];

/**
 * The keys `specs/controls.md` binds, as a player would read them off a how-to
 * screen, beside the words a pointer is described with.
 *
 * `KeyR` is the key `R`, `Digit1` the key `1`, and `ArrowUp` an arrow; a build is
 * free to name any of them, or to describe the pointer instead, because
 * `specs/controls.md` gives the game both and `specs/screens.md` fixes no wording.
 * The subject fails only when the screen names no key and no press at all.
 */
const CONTROL_WORDS: readonly string[] = [
  ...new Set(
    Object.values(BINDINGS)
      // The eight `Digit` bindings are left out: a lone digit is not evidence of
      // a controls line, and this screen carries figures of its own.
      .filter((code) => !code.startsWith("Digit"))
      .map((code) =>
        code
          .replace(/^Key/, "")
          .replace(/^Arrow.*$/, "ARROW")
          .replace(/^Escape$/, "ESC")
          .toUpperCase(),
      ),
  ),
  "ESCAPE",
  "ARROWS",
  "KEY",
  "KEYS",
  "TAP",
  "CLICK",
  "PRESS",
  "MOUSE",
  "POINTER",
  "TOUCH",
];

/** Whether the frame drew any of `words` as a standalone word. */
function names(calls: readonly DrawCall[], words: readonly string[]): boolean {
  return words.some((word) => drewWord(calls, word));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a body of text naming every subject the how-to screen covers", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("howto");

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the copy is read on",
  );

  assertGreaterThanOrEqual(
    lettersIn(drawnText(calls)),
    HOWTO_MIN_LETTERS,
    `the letters of text the how-to screen drew; it covers nine subjects ` +
      `(specs/screens.md), which no screen does without prose`,
  );

  for (const { subject, words } of SUBJECTS) {
    assertEqual(
      names(calls, words),
      true,
      `the how-to screen named ${subject}, by any of ${words.join(", ")} ` +
        `(specs/screens.md)`,
    );
  }
  assertEqual(
    names(calls, CONTROL_WORDS),
    true,
    `the how-to screen covered the controls, by naming any key ` +
      `specs/controls.md binds or any word a press is described with ` +
      `(${CONTROL_WORDS.join(", ")})`,
  );
});
