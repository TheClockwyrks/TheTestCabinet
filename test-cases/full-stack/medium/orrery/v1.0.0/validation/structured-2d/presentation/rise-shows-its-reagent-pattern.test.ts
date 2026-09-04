// presentation/rise-shows-its-reagent-pattern — a placed rise draws the reagent it
// will deliver, at the pose it was placed at.
//
// THE RULE. "A rise shows its reagent's pattern and a set shows its product's
// pattern" (`specs/parts.md`, Presentation); `specs/assets.md` puts "The reagent
// pattern a rise shows and the product pattern a set shows" under "What stays
// drawn in code".
//
// WHAT THERE IS TO SHOW. "A `rise` delivers one reagent ... A rise or set is
// placed at an anchor and rotation like any sigil, and its footprint is its
// pattern's hexes placed at that pose: the molecule pattern for a rise"
// (`specs/parts.md`), and what will appear there is "one new mote per pattern mote
// and one filament per pattern filament, at the placed pose"
// (`specs/sigils.md`). So what a player reads before a run is the motes AND the
// filaments of that pattern, on the hexes the placed pose puts them on.
//
// THE POSE IS ROTATED ON PURPOSE. "A pattern is placed onto the field at an anchor
// hex and a rotation `0` to `5`: each pattern coordinate is rotated about `(0, 0)`
// by the rotation ... then translated by the anchor. Filament endpoints rotate the
// same way" (`specs/field.md`). A rise placed at rotation `2` therefore shows its
// second mote on the ROTATED hex, and the hex the unrotated pattern names is
// nothing to do with it — which is read here in both directions, so a build that
// draws the pattern at rotation `0` wherever it is placed fails.
//
// WHERE THE FILAMENT IS READ. Two adjacent hex centres are `HEX_PITCH` (`48`)
// apart and `specs/assets.md` draws a strip "centered on the midpoint between the
// two motes' centers", so the square about that midpoint is where a shown filament
// lands and where the two motes' own art does not reach — `MOTE_R` (`22`) bounds a
// mote's paint and the midpoint is `24` from either centre.
//
// THE SCENE IS THE EDITOR, WITH NO RUN, which is what "before a run starts" means:
// nothing has spawned, so what is on those hexes is the rise's own drawing rather
// than motes.
//
// THE VERDICT. Every hex of the placed rise's footprint, and the midpoint of the
// pattern's one filament, is drawn apart from the bare field there; the hex the
// pattern would have reached unrotated is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { at, hexCenter, place, type Hex, type StagePoint } from "../field";
import { challenge, type Challenge } from "../formats";
import { ORIGIN, TWO_LUNA } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  partById,
  placeRise,
  type Harness,
  type PixelRect,
} from "../harness";
import { riseFootprint } from "../parts";

/**
 * A challenge whose one reagent is TWO motes joined by a filament.
 *
 * `specs/formats.md` lets a reagent be any well-formed molecule, and a two-mote
 * pattern is what makes this point decidable: a one-mote reagent has no second hex
 * for a rotation to move and no filament to show.
 */
const PAIRED_REAGENT: Challenge = challenge({
  name: "Paired Reagent",
  reagents: [TWO_LUNA],
  products: [TWO_LUNA],
  permitted: ["arm"],
});

/** The rotation the rise is placed at, so the pattern is really turned. */
const ROTATION = 2;

/** Half the side of the square a hex is read over; inside its own cell. */
const HALF = 18;

/** Half the side of the square a filament is read over. */
const LINK_HALF = 10;

/** The least share of a square the rise must redraw where it shows something. */
const MIN_DISTINCT_SHARE = 0.05;

/** How much of a square the rise may redraw where it shows nothing. */
const UNTOUCHED_SHARE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(point: StagePoint, half: number): Promise<PixelRect> {
  return h.pixelRect(point.x - half, point.y - half, 2 * half, 2 * half);
}

function midpointOf(a: Hex, b: Hex): StagePoint {
  const from = hexCenter(a);
  const to = hexCenter(b);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

it("draws the reagent's motes and filament at the rise's placed anchor and rotation", async () => {
  await openChallengeDocument(h, PAIRED_REAGENT);
  await h.advance(1);

  const reagent = TWO_LUNA;
  const shown = riseFootprint(reagent, ORIGIN, ROTATION);
  const filament = reagent.filaments[0];
  assertEqual(
    shown.length,
    reagent.motes.length,
    "the rise's footprint is its reagent's pattern placed at its pose, so there is one hex to read per pattern mote",
  );

  const link = midpointOf(
    place(filament?.a as Hex, ORIGIN, ROTATION),
    place(filament?.b as Hex, ORIGIN, ROTATION),
  );
  // The hex the pattern's second mote would sit on if the placed rotation were
  // ignored, which the rise at rotation 2 does not reach.
  const unrotated = place(
    at(reagent.motes[1]?.q ?? 0, reagent.motes[1]?.r ?? 0),
    ORIGIN,
    0,
  );

  const bare: PixelRect[] = [];
  for (const hex of shown) bare.push(await square(hexCenter(hex), HALF));
  const bareLink = await square(link, LINK_HALF);
  const bareUnrotated = await square(hexCenter(unrotated), HALF);

  const rise = await placeRise(h, 0, ORIGIN, ROTATION);
  // The editor outlines the selected part's footprint (`specs/editor.md`), which
  // would mark the hexes this point reads for a reason that is not the pattern.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "rise");

  const placed = partById(await h.snapshot(), rise);
  assertEqual(
    placed?.rotation,
    ROTATION,
    "the rise really stands at the rotation its pattern is read against",
  );
  assertEqual(
    placed?.index,
    0,
    "the rise is the one for reagent 0, whose pattern is the one read here",
  );

  for (const [index, hex] of shown.entries()) {
    assertGreaterThan(
      differingShare(
        bare[index] as PixelRect,
        await square(hexCenter(hex), HALF),
      ),
      MIN_DISTINCT_SHARE,
      `the rise draws its reagent's mote on (${hex.q}, ${hex.r}), which is where the placed anchor and rotation put it`,
    );
  }

  assertGreaterThan(
    differingShare(bareLink, await square(link, LINK_HALF)),
    MIN_DISTINCT_SHARE,
    "the rise draws the filament of its reagent's pattern between the two motes it will deliver",
  );

  assertLessThan(
    differingShare(bareUnrotated, await square(hexCenter(unrotated), HALF)),
    UNTOUCHED_SHARE,
    `nothing is drawn on (${unrotated.q}, ${unrotated.r}), the hex the pattern would reach unrotated, so the pattern is shown at the pose the rise was placed at`,
  );
});
