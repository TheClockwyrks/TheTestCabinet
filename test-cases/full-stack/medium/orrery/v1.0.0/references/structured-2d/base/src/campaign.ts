// Orrery — the campaign course this build authors (specs/modes/campaign.md).
//
// Thirteen challenges, in order, between `CAMPAIGN_MIN` (8) and `CAMPAIGN_MAX`
// (16). The course is a COURSE: it teaches the machine one idea at a time, and
// each challenge is built so that the idea it introduces is the idea its
// answer turns on.
//
//   1  Meridian             an arm carries a mote from a rise to a set
//   2  Emberfall            `wane`: a sigil transmutes what passes over it
//   3  The Bound Pair       `bind`: two motes become one constellation
//   4  The Zodiac Wheel     `wheel` and `mirror`: a fixture is an essence
//   5  The Long Reach       `piston`: one arm, two radii
//   6  The Carriage         `track`: an arm that translates what it carries
//   7  Quicksilver Ladder   `ascend` climbed twice, by a biarm's two grippers
//   8  The Second Rung      `conjoin`: two motes must arrive together
//   9  Umbra and Lumen      `eclipse`: one sigil, two products, two sets
//  10  Chaff and Grain      `sunder` and `void`: taking a reagent apart
//  11  Threefold Cord       `triune` and `manifold`: a constellation of four
//  12  Aether Undone        `dispersion`: one reagent, four consequences
//  13  The Great Work       `confluence`, `hexarm`: the whole machine at once
//
// The three pressures specs/modes/campaign.md names are spread across it:
// reach and geometry in 5 and 6, timing several arms against one shared period
// in 7, 8, 9 and 13, and chains of transmutation in 4, 10, 11, 12 and 13. Every
// part kind of `PARTS` stands in at least one tray here, and the intended
// answer to some challenge places every one of them.
//
// A product delivered by an earlier challenge is a reagent of a later one:
// `dust` leaves 1 and 2 and returns as the reagent of 3, 6, 9 and 13, and the
// `nova` of 4 returns as the reagent of 11.
//
// A tray offers more than one machine can want, so the kind a challenge is
// named for is not always the kind its reference solution turns on: the trays
// of 9, 11, 12 and 13 all admit a triarm, and the reference that first places
// one is 11's. What every reference DOES place, between them, is all
// twenty-one kinds of `PARTS`, which `src/solutions.test.ts` asserts.
//
// The documents are written in the challenge format of specs/formats.md and
// parsed by `src/challenges.ts`, so a typo here is a loud failure at start-up.

import { CONSTELLATION_TARGET } from "./constants";

/** The campaign course, in order, as challenge documents. */
export const CAMPAIGN_DOCUMENTS: unknown[] = [
  // 1. One arm, one mote, one turn: the whole game in three parts.
  {
    name: "Meridian",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    permitted: ["arm"],
    target: CONSTELLATION_TARGET,
  },
  // 2. The same carry, with a `wane` engraved on the way: a sigil acts on what
  //    rests on it at a boundary, held or not.
  {
    name: "Emberfall",
    reagents: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    permitted: ["arm", "wane"],
    target: CONSTELLATION_TARGET,
  },
  // 3. Two deliveries make one product: the pair is bound where it stands and
  //    carried to the set as one rigid body.
  {
    name: "The Bound Pair",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "dust" },
          { q: 1, r: 0, type: "dust" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["arm", "bind"],
    target: CONSTELLATION_TARGET,
  },
  // 4. A wheel's fixtures are the only essences on the field, and `mirror`
  //    copies one onto a dust the arm parks beside it.
  {
    name: "The Zodiac Wheel",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
    permitted: ["arm", "wheel", "mirror"],
    target: CONSTELLATION_TARGET,
  },
  // 5. Two rises at two radii from one base: a fixed arm reaches one or the
  //    other, and a piston reaches both.
  {
    name: "The Long Reach",
    reagents: [
      { motes: [{ q: 0, r: 0, type: "comet" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "meteor" }], filaments: [] },
    ],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "comet" },
          { q: 1, r: 0, type: "meteor" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["piston", "bind"],
    target: CONSTELLATION_TARGET,
  },
  // 6. A straight chain of three cannot be built by rotation alone: the bound
  //    pair has to be TRANSLATED one hex before the third mote is joined, and
  //    a mounted arm's `advance` is the translation.
  {
    name: "The Carriage",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "dust" },
          { q: 1, r: 0, type: "dust" },
          { q: 2, r: 0, type: "dust" },
        ],
        filaments: [
          { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
          { a: { q: 1, r: 0 }, b: { q: 2, r: 0 }, weight: 1 },
        ],
      },
    ],
    permitted: ["arm", "track", "bind"],
    target: CONSTELLATION_TARGET,
  },
  // 7. One `ascend` climbed twice: the planet waits on the crown while two
  //    separate deliveries of `mercury` are spent on it.
  {
    name: "Quicksilver Ladder",
    reagents: [
      { motes: [{ q: 0, r: 0, type: "mercury" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "saturn" }], filaments: [] },
    ],
    products: [{ motes: [{ q: 0, r: 0, type: "mars" }], filaments: [] }],
    permitted: ["arm", "biarm", "ascend"],
    target: CONSTELLATION_TARGET,
  },
  // 8. `conjoin` is the first sigil that asks for two motes AT ONCE, on two
  //    hexes, with the crown clear: the first challenge about timing.
  {
    name: "The Second Rung",
    reagents: [{ motes: [{ q: 0, r: 0, type: "saturn" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "jupiter" }], filaments: [] }],
    permitted: ["arm", "biarm", "piston", "conjoin"],
    target: CONSTELLATION_TARGET,
  },
  // 9. One sigil, two products, and an arm whose alternate spokes land on both
  //    crowns at once.
  {
    name: "Umbra and Lumen",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [
      { motes: [{ q: 0, r: 0, type: "umbra" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "lumen" }], filaments: [] },
    ],
    permitted: ["arm", "biarm", "triarm", "eclipse"],
    target: CONSTELLATION_TARGET,
  },
  // 10. The first reagent that arrives as a constellation. `sunder` takes it
  //     apart; the half nobody wants has to go somewhere, and `void` is where.
  {
    name: "Chaff and Grain",
    reagents: [
      {
        motes: [
          { q: 0, r: 0, type: "nova" },
          { q: 1, r: 0, type: "dust" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    products: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
    permitted: ["arm", "piston", "sunder", "void"],
    target: CONSTELLATION_TARGET,
  },
  // 11. A constellation of four with one triune arm: `triune` writes the heavy
  //     filament first, and `manifold` binds the rest of the star in one act.
  {
    name: "Threefold Cord",
    reagents: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "nova" },
          { q: 1, r: 0, type: "nova" },
          { q: -1, r: 1, type: "nova" },
          { q: 0, r: -1, type: "nova" },
        ],
        filaments: [
          { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 3 },
          { a: { q: 0, r: 0 }, b: { q: -1, r: 1 }, weight: 1 },
          { a: { q: 0, r: 0 }, b: { q: 0, r: -1 }, weight: 1 },
        ],
      },
    ],
    permitted: ["arm", "biarm", "triarm", "bind", "triune", "manifold"],
    target: CONSTELLATION_TARGET,
  },
  // 12. One `aether` becomes four motes on four crowns. Two of them are
  //     products; the other two must be gone before the next one can disperse.
  {
    name: "Aether Undone",
    reagents: [{ motes: [{ q: 0, r: 0, type: "aether" }], filaments: [] }],
    products: [
      { motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "comet" }], filaments: [] },
    ],
    permitted: [
      "arm",
      "biarm",
      "triarm",
      "piston",
      "track",
      "dispersion",
      "void",
    ],
    target: CONSTELLATION_TARGET,
  },
  // 13. The whole machine at once: a turning wheel presents each essence in
  //     turn, one mirror paints dust with whichever is standing at its source,
  //     and `confluence` gathers all four into the quintessence.
  {
    name: "The Great Work",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "aether" }], filaments: [] }],
    permitted: [
      "arm",
      "biarm",
      "triarm",
      "hexarm",
      "piston",
      "wheel",
      "track",
      "bind",
      "mirror",
      "confluence",
      "void",
    ],
    target: CONSTELLATION_TARGET,
  },
];
