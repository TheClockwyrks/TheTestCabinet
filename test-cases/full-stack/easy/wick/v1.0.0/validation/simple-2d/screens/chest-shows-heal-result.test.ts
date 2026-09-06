// screens/chest-shows-heal-result — the chest overlay shows a heal.
//
// WHAT THIS DECIDES. One thing: when a chest healed rather than evolving or
// leveling, the overlay says so in its own words, and those words are not the
// ones it shows for the other two results.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`, the result table): "`heal` | That the lamplighter was
//   healed `CHEST_HEAL` (`30`), in words of your own", under the heading
//   `CHEST_TEXT`.
//   specs/evolutions.md ("Opening a chest"): the result is "decided by the
//   first of these rules that applies", so a loadout with no eligible evolution
//   and no item below its max falls to "3. Heal."
//   specs/progression.md ("Slots"): "A base weapon levels up to
//   `MAX_WEAPON_LEVEL`", so Taper held at `8` is not a level candidate.
//
// THE DRIVE, AND WHY IT OPENS THREE CHESTS. The words are the build's own, so
// what can be decided is that the overlay SAYS something for a heal and that
// what it says differs from what it says for the other two results. The same
// isolated `playing` run is posed three times, once per result: Taper at its
// max beside Wick evolves, Taper at `3` levels, and Taper at its max with no
// passive falls through to the heal. Each chest is collected by one tick at the
// lamplighter's center, the real path, and the three frames are read as three
// corpora of drawn text. The runs the heal frame drew that neither of the other
// two drew are what this point requires to exist; the heading and the HUD are
// common to all three, so they cancel.
//
// Each frame is read TWICE, and the difference is taken under each reading: as
// the raw `fillText` strings (`drawnText`) and as the LOGICAL runs the frame
// spelled (`drawnTextLines`). A build that letter-spaces its result copy draws
// one glyph per call, and read per call the heal frame's single letters would
// be cancelled one by one by the same letters in the other two frames' copy, so
// the difference could reach zero while the words differed; read as runs, the
// heal's whole line is not the level's or the evolution's. But a set difference
// is not monotone under coalescing in either direction — a build whose heal
// copy merges with a footer it shares with the other results, or a plain build
// whose raw call stood alone, can lose under one reading what it keeps under
// the other — so the point passes when EITHER difference is non-empty.
//
// THE TOLERANCE. None: a string is either in the difference or it is not.
// Nothing about the wording, its colour, or its place is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drawnTextLines,
  holdPassive,
  holdWeapon,
  isolate,
  minusLines,
  openChest,
  type DrawCall,
  type Harness,
} from "../harness";

/** One frame's drawn text under each reading: the raw calls, then the logical runs. */
type Readings = [raw: string[], runs: string[]];

/** Both readings of one frame, in the order {@link Readings} fixes. */
function readings(calls: readonly DrawCall[]): Readings {
  return [drawnText(calls), drawnTextLines(calls)];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("says something for a heal that it does not say for a level or an evolution", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);
  const evolved = await openChest(h);
  assertEqual(
    evolved.run.chestResult?.kind,
    "evolve",
    "the first chest's result",
  );
  const evolveText = readings((await h.frameDraw()).calls);

  isolate(h);
  holdWeapon(h, "taper", 3);
  const leveled = await openChest(h);
  assertEqual(
    leveled.run.chestResult?.kind,
    "level",
    "the second chest's result",
  );
  const levelText = readings((await h.frameDraw()).calls);

  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  const healed = await openChest(h);
  assertEqual(healed.screen, "chest", "the screen the third chest opened");
  assertDeepEqual(
    healed.run.chestResult,
    { kind: "heal" },
    "the third chest's result",
  );
  const healText = readings((await h.frameDraw()).calls);
  captureStill(h, "heal");

  const own = healText.map((heal, reading) =>
    minusLines(minusLines(heal, levelText[reading]), evolveText[reading]),
  );
  assertGreaterThan(
    Math.max(...own.map((extra) => extra.length)),
    0,
    "text the heal result drew that the level and evolve results did not, read as raw calls or as logical runs",
  );
});
