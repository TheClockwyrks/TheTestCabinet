// sigils/rise-spawns-reagent-motes — a vacant footprint fills with the reagent.
//
// THE RULE. "`rise` — A rise's footprint is as `specs/parts.md` defines it. When
// every footprint hex is vacant, the reagent appears: one new mote per pattern
// mote and one filament per pattern filament, at the placed pose, unheld"
// (`specs/sigils.md`, Rises and sets). `specs/parts.md` fixes what a pattern mote
// is: "Reagents and products are written as molecule patterns: a set of motes on
// relative hex coordinates plus the filaments between them" (`specs/field.md`),
// each entry placing "one mote type at `(q, r)`" (`specs/formats.md`). This point
// is the motes; the filaments are the neighbouring item's.
//
// THE CHALLENGE IS POSED, NOT SHIPPED. A reagent of THREE motes of three different
// types is stated here, so "one new mote per pattern mote, each of the pattern's
// type on the pattern's hex" has something to say: a build that spawned one mote,
// or spawned three of one type, or put them on the wrong hexes, fails. "Every
// molecule pattern is connected" (`specs/formats.md`), so the three carry the two
// filaments that join them.
//
// THE WORLD IS THE RISE. The bare opener clears the field, so every footprint hex
// is vacant by construction, and the machine holds the one rise: no set to consume
// what appears, no sigil to transmute it, no arm to carry it.
//
// THE VERDICT. After the boundary each pattern hex, placed at the rise's pose
// through `specs/field.md`'s own placement formula, holds a mote of that pattern
// entry's type, and the field holds exactly three motes — so nothing further was
// spawned either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, place } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import { ONE_DUST, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  placeRise,
  type Harness,
} from "../harness";

/** Three motes of three types, joined into one connected pattern. */
const TRIAD = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "nova"), mote(0, 1, "luna")],
  [link(at(0, 0), at(1, 0)), link(at(0, 0), at(0, 1))],
);

/** A challenge whose one reagent is that triad. */
const TRIAD_RISE = challenge({
  name: "Triad Rise",
  reagents: [TRIAD],
  products: [ONE_DUST],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns one mote per pattern mote, each of the pattern's type on the pattern's hex", async () => {
  await openBareRun(h, { challenge: TRIAD_RISE });
  await placeRise(h, 0, ORIGIN, 0);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.motes ?? [],
    0,
    "the field is empty, so every hex of the rise's footprint is vacant",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "spawn");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a rise that delivers raises no fault, so the run is still live",
  );
  assertLength(
    after.sim?.motes ?? [],
    TRIAD.motes.length,
    "one new mote per pattern mote, and nothing further",
  );
  for (const entry of TRIAD.motes) {
    const hex = place(at(entry.q, entry.r), ORIGIN, 0);
    const landed = moteAt(after, hex);
    assertNotNull(
      landed,
      `a mote rests on the pattern hex (${hex.q}, ${hex.r}) of the delivered reagent`,
    );
    assertEqual(
      landed?.type,
      entry.type,
      `the mote on (${hex.q}, ${hex.r}) is the ${entry.type} the pattern puts there`,
    );
  }
});
