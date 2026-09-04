// presentation/members-told-apart-by-form — a strut, a cable and a rail are told
// apart by their shape and not by their colour alone.
//
// `specs/overview.md` § Visual design: "A strut, a cable, and a rail are TOLD
// APART AT A GLANCE, BY FORM AND NOT BY HUE ALONE." The requirement has two
// halves and the second is the sharp one: a build that draws all three as the
// same bar in three colours fails it, and a player who cannot tell hues apart is
// exactly who it is for.
//
// SO THE READING IS THE EXTENT, NOT THE COLOUR. Each of the three is placed over
// THE SAME TWO NODES, so the span they cross is identical and anything left in
// the size they report is the form the build drew them in — its thickness, its
// profile, its silhouette. Three members over one span, and what must differ is
// how much room each takes up.
//
// NOTHING HERE READS A PALETTE. Which colour a build picks for a strut is its own
// ("Palettes, fonts, layouts, and styling are the build's choices"), so colour is
// never compared; what is compared is whether the forms stand apart with the hues
// set aside entirely.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The span all three are placed over, so only their form can differ. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 2, z: 0 };

/** How much of a unit two forms must differ by across their profile. */
const APART = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The through-thickness a member was drawn with: the smallest of its three
 * extents, which for a bar is its cross-section and never its length.
 *
 * Read this way so members over different spans can be compared at all — what
 * differs between two forms is how thick each is drawn, not how far it reaches.
 */
const profileOf = (size: readonly [number, number, number]): number =>
  Math.min(size[0], size[1], size[2]);

it("draws a strut, a cable and a rail in forms that differ", async () => {
  await openSite(h, 0);

  const profiles = new Map<string, number>();
  for (const material of ["strut", "cable"] as const) {
    await clearAll(h);
    await h.debug.setScreen("build");
    await h.debug.setRing(4, 2, 0);
    await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, material);
    await h.advance(1);
    const drawn = entriesOf(await h.drawn(), "member", material);
    assertTrue(drawn.length > 0, `a ${material} among what the frame drew`);
    profiles.set(material, profileOf(drawn[0]!.size));
  }

  // A RAIL CANNOT SHARE THAT SPAN. `specs/structure.md` fixes where one may go —
  // "Every rail member is horizontal", "Every rail member is in the arm" — so a
  // rail is read off a crane that stands instead. Its span is its own, which is
  // why the reading below is the THROUGH-THICKNESS rather than the whole extent:
  // that is the part of a bar's form that does not follow its length.
  await standMinimalCrane(h);
  await h.advance(1);
  const rails = entriesOf(await h.drawn(), "member", "rail");
  await h.capture("materials", "The three materials, each over the same span");

  assertTrue(rails.length > 0, "a rail among what the standing crane drew");
  profiles.set("rail", profileOf(rails[0]!.size));

  const pairs: readonly (readonly [string, string])[] = [
    ["strut", "cable"],
    ["strut", "rail"],
    ["cable", "rail"],
  ];
  for (const [a, b] of pairs) {
    const apart = Math.abs(profiles.get(a)! - profiles.get(b)!);
    assertTrue(
      apart >= APART,
      `a ${a} and a ${b} over the same span to be drawn in different forms — ` +
        `their profiles were ${profiles.get(a)!.toFixed(3)} and ` +
        `${profiles.get(b)!.toFixed(3)}, ${apart.toFixed(3)} apart ` +
        "(specs/overview.md: told apart by form and not by hue alone)",
    );
  }
});
