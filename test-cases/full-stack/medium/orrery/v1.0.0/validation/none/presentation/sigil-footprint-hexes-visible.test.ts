// presentation/sigil-footprint-hexes-visible — every hex a placed sigil reads is
// drawn apart from a bare field hex.
//
// THE RULE. "A sigil's footprint hexes are visible, and the hexes
// `specs/sigils.md` gives roles to read apart" (`specs/parts.md`, Presentation).
// `specs/assets.md` puts "Each sigil's footprint hexes and the roles its
// distinguished hexes carry" under "What stays drawn in code", so a footprint is
// the build's own drawing rather than a produced file.
//
// WHAT A FOOTPRINT IS. "Footprints are written as relative hexes at rotation `0`;
// a placed sigil's hexes are its footprint rotated and translated"
// (`specs/sigils.md`), and `parts.ts` carries every one of the twelve tables
// exactly as that file tabulates them — so the hexes read here are the
// specification's, not the build's report of them. A `void` is seven hexes and a
// `wane` is one; both are read the same way.
//
// WHY IT MATTERS BEFORE A RUN. A sigil "acts at each boundary ... on the motes
// resting on its hexes", so which hexes those are is what a player has to see to
// build a machine at all. The scene is therefore the editor with no run: the
// hexes are read off the field the way a player reads them while placing.
//
// THE COMPARISON IS AGAINST THE SAME HEX, BARE. Every hex the twelve footprints
// reach is read once on the empty field and again with the sigil engraved, so what
// the two frames differ by is the sigil and nothing else — no palette, no
// geometry, and no mark is required of the build, only that the hex is no longer
// drawn as a bare one.
//
// THE VERDICT. For each of the twelve transforming sigils, every hex of its placed
// footprint is drawn differently from the bare field hex under it, over at least
// `MIN_DISTINCT_SHARE` of that hex.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { TRANSFORMING_SIGILS, type SigilName } from "../constants";
import { hexCenter, onField, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  differingShare,
  openChallengeDocument,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";
import { sigilHexes } from "../parts";

/** Half the side of the square one hex is read over; inside its own cell. */
const HALF = 18;

/** The least share of that square a placed footprint hex must redraw. */
const MIN_DISTINCT_SHARE = 0.05;

/**
 * The order the twelve are swept in, `confluence` first.
 *
 * The point's evidence is a confluence footprint, and `captureStill` keeps
 * whatever the last frame drew — so the sigil the picture is of is posed and
 * captured before any assertion can end the check.
 */
const SWEEP: readonly SigilName[] = [
  "confluence",
  ...TRANSFORMING_SIGILS.filter((kind) => kind !== "confluence"),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF);
}

it("draws every hex of each of the twelve sigils' footprints apart from a bare hex", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);

  // The bare field, read once at every hex any of the twelve footprints reaches.
  const bare = new Map<string, PixelRect>();
  for (const kind of SWEEP) {
    for (const hex of sigilHexes(kind, ORIGIN, 0)) {
      const key = `${hex.q},${hex.r}`;
      assertTrue(
        onField(hex),
        `hex (${key}) of a ${kind} anchored on the field's middle is on the field, so it is drawn at all`,
      );
      if (!bare.has(key)) bare.set(key, await square(hex));
    }
  }

  for (const kind of SWEEP) {
    await clearWorld(h);
    await placePart(h, kind, ORIGIN, 0);
    // The editor draws the selected part distinctly (`specs/editor.md`); this
    // point is not about that, so the selection is held clear.
    await h.debug.setSelected(null);
    await h.advance(1);
    if (kind === "confluence") await captureStill(h, "footprint");

    for (const hex of sigilHexes(kind, ORIGIN, 0)) {
      const key = `${hex.q},${hex.r}`;
      assertGreaterThan(
        differingShare(bare.get(key) as PixelRect, await square(hex)),
        MIN_DISTINCT_SHARE,
        `hex (${key}) of the placed ${kind}'s footprint is drawn apart from the bare field hex under it, so the hexes the sigil reads are read off the field before a run`,
      );
    }
  }
});
