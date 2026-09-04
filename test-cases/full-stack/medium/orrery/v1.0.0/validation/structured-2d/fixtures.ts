// Orrery — the posed worlds the suites reuse. CASE-PROVIDED, and the SAME FILE in
// all three engine projects.
//
// A VALIDATOR POSES A WORLD RATHER THAN SEARCHING ONE. Every check clears the
// field and spawns back exactly what its requirement concerns, and what it opens
// is one of the challenges below: small, well formed, and chosen so the thing the
// check is about is the only thing on the field. `harness.ts`'s openers are how a
// check gets there in one call; this file is what they open.
//
// NOTHING HERE IS READ OFF A REFERENCE. Each challenge is authored against
// `specs/formats.md`, each machine against `specs/parts.md`, and the ten Extras —
// which are fixed data rather than a fixture — live next door in `challenges.ts`,
// quoted from `specs/challenges.md`.
//
// THE PERMITTED LIST IS A TRAY RULE, NOT A PLACEMENT RULE.
// `specs/instrumentation.md` is explicit: the machine operations are "checked
// against the placement rules of `specs/parts.md` alone", so a check that poses a
// wheel through `placePart` on a challenge permitting only `arm` is posing a
// legal machine. The permitted lists below are therefore written for the TRAY
// checks that read them, and every other check may ignore them.

import { CONSTELLATION_TARGET } from "./constants";
import { at, type Hex } from "./field";
import {
  armPart,
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  pair,
  risePart,
  setPart,
  sigilPart,
  solution,
  trackPart,
  type Challenge,
  type Molecule,
  type Solution,
} from "./formats";

/* -------------------------------------------------------------------------- */
/* Hexes a scenario stands on                                                 */
/* -------------------------------------------------------------------------- */
//
// Three anchors far enough apart that a rise's footprint, a set's footprint, and
// a one-length arm's grippers cannot meet, all comfortably inside the field of
// radius `FIELD_R` (5). A check that needs its own geometry states its own; these
// are for the checks that need somewhere to stand and do not care where.

/** The middle of the field, where a scenario with one thing on it puts that thing. */
export const ORIGIN: Hex = at(0, 0);

/** A hex on the field's west side, clear of {@link ORIGIN} and {@link EAST}. */
export const WEST: Hex = at(-3, 0);

/** A hex on the field's east side, clear of {@link ORIGIN} and {@link WEST}. */
export const EAST: Hex = at(3, 0);

/** A hex two rows south of {@link ORIGIN}, for a second constellation. */
export const SOUTH: Hex = at(0, 3);

/** A hex two rows north of {@link ORIGIN}. */
export const NORTH: Hex = at(0, -3);

/**
 * A hex OFF the field, which `specs/simulation.md` lets a mote rest on: "A mote
 * may be carried over, dropped on, and rest on a hex off the field."
 * `spawnMote` "poses a hex off the field like any other".
 */
export const OFF_FIELD: Hex = at(9, 0);

/* -------------------------------------------------------------------------- */
/* Molecules                                                                  */
/* -------------------------------------------------------------------------- */

/** One `dust` on `(0, 0)`: the smallest molecule there is. */
export const ONE_DUST: Molecule = loneMote("dust");

/** One `sol`, the top rung of `PLANETS`, which no sigil transmutes further. */
export const ONE_SOL: Molecule = loneMote("sol");

/** Two `luna` joined east by a plain filament. */
export const TWO_LUNA: Molecule = pair("luna", "luna");

/** Two `nova` joined east by a TRIUNE filament (`specs/sigils.md`'s `triune`). */
export const TWO_NOVA_TRIUNE: Molecule = pair("nova", "nova", 3);

/**
 * A chain of `luna` repeating east: the shape a repeating set accepts `k >=
 * REPEAT_MIN` (`2`) chained copies of (`specs/sigils.md`).
 */
export const REPEATING_LUNA: Molecule = molecule([mote(0, 0, "luna")], [], {
  vector: at(1, 0),
  link: link(at(0, 0), at(1, 0), 1),
});

/** Three motes in a line, joined west-to-east: a constellation with an interior. */
export const THREE_DUST_LINE: Molecule = molecule(
  [mote(0, 0, "dust"), mote(1, 0, "dust"), mote(2, 0, "dust")],
  [link(at(0, 0), at(1, 0)), link(at(1, 0), at(2, 0))],
);

/* -------------------------------------------------------------------------- */
/* Challenges                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The bare world: one `sol` in, the same `sol` out, one permitted kind.
 *
 * What almost every check opens. The rise spawns a single unbonded mote, the set
 * accepts a single unbonded mote, no sigil is on the field to act on anything,
 * and the tray holds three entries — so a check that clears the machine and
 * places its own one part is looking at that part and nothing else.
 */
export const BARE: Challenge = challenge({
  name: "Bare",
  reagents: [ONE_SOL],
  products: [ONE_SOL],
  permitted: ["arm"],
});

/**
 * A world whose product is TWO motes joined by a filament, so a set has something
 * to reject as well as something to accept, and `bind` is on the tray.
 */
export const PAIRED: Challenge = challenge({
  name: "Paired",
  reagents: [loneMote("luna")],
  products: [TWO_LUNA],
  permitted: ["arm", "bind"],
});

/**
 * A world whose one product REPEATS, for the checks about a repeating set's
 * footprint, its acceptance rule, and the `k` its tally rises by.
 */
export const REPEATING: Challenge = challenge({
  name: "Repeating",
  reagents: [loneMote("luna")],
  products: [REPEATING_LUNA],
  permitted: ["arm", "piston", "track", "bind"],
});

/**
 * A world with TWO reagents and TWO products, for the checks about the tray
 * deriving one rise per reagent and one set per product in order, about
 * per-product tallies, and about a completion that needs both targets reached.
 */
export const TWO_AND_TWO: Challenge = challenge({
  name: "Two And Two",
  reagents: [loneMote("dust"), loneMote("nova")],
  products: [loneMote("dust"), loneMote("nova")],
  permitted: ["arm", "biarm"],
});

/**
 * A world permitting the widest tray `specs/formats.md` allows: fourteen
 * permitted kinds plus one rise and one set is `TRAY_MAX` (`16`) entries exactly.
 *
 * For the tray checks, which are about the order the entries are listed in and
 * the bound on how many there are. The kinds are in `PARTS` order already, which
 * is the order `specs/editor.md` requires the tray to list them in, so a check
 * comparing the tray against this list is comparing against the specification's
 * own ordering rather than against the order they happen to be written in.
 */
export const FULL_TRAY: Challenge = challenge({
  name: "Full Tray",
  reagents: [ONE_DUST],
  products: [ONE_DUST],
  permitted: [
    "arm",
    "biarm",
    "triarm",
    "hexarm",
    "piston",
    "wheel",
    "track",
    "bind",
    "manifold",
    "triune",
    "sunder",
    "wane",
    "mirror",
    "ascend",
  ],
});

/**
 * A world whose target is `1`, so ONE accepted constellation completes the run.
 *
 * `specs/formats.md` requires only that `target` is "at least `1`" and notes that
 * every challenge the game SHIPS uses `CONSTELLATION_TARGET` (`6`); a loaded
 * document is a challenge like any other, so a check about what a completing
 * boundary does can reach one in a single delivery rather than in six.
 */
export const ONE_DELIVERY: Challenge = challenge({
  name: "One Delivery",
  reagents: [ONE_SOL],
  products: [ONE_SOL],
  permitted: ["arm"],
  target: 1,
});

/** Every fixture challenge, for a check that sweeps them. */
export const CHALLENGES: readonly Challenge[] = [
  BARE,
  PAIRED,
  REPEATING,
  TWO_AND_TWO,
  FULL_TRAY,
  ONE_DELIVERY,
];

/* -------------------------------------------------------------------------- */
/* Machines                                                                   */
/* -------------------------------------------------------------------------- */

/** The empty machine, which `specs/formats.md` explicitly allows. */
export const EMPTY_MACHINE: Solution = solution([]);

/**
 * A rise west, a set east, and one arm between them at rest with an empty tape:
 * a machine that runs, delivers nothing, and faults at nothing.
 *
 * Legal on {@link BARE} and on {@link ONE_DELIVERY}, whose reagent and product
 * are both one mote on `(0, 0)`.
 */
export const IDLE_MACHINE: Solution = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

/**
 * One arm at the origin, rotation `0`, length `1`, with a tape that grabs, turns
 * one step clockwise, drops, and turns back: the shortest complete carrying
 * cycle, period `4`.
 */
export const CARRY_MACHINE: Solution = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [
    "grab",
    "rotate-cw",
    "drop",
    "rotate-ccw",
  ]),
]);

/**
 * A five-cell open track running east, with a piston mounted on its first cell.
 *
 * For the checks about `advance`, `recede`, `track-end`, and a part's live base
 * cell: the track is open, so moving past either end faults.
 */
export const TRACKED_MACHINE: Solution = solution([
  trackPart([at(-2, 0), at(-1, 0), at(0, 0), at(1, 0), at(2, 0)]),
  armPart("piston", -2, 0, 0, 1, ["advance"]),
]);

/** A closed triangular track, the shortest a closed one may be: three cells. */
export const CLOSED_TRACK: Solution = solution([
  trackPart([at(0, 0), at(1, 0), at(0, 1)], true),
]);

/** One wheel at the origin at rotation `0`, with an empty tape. */
export const WHEEL_MACHINE: Solution = solution([
  armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

/** One `bind` sigil at the origin, unrotated: its two hexes run `(0,0)`–`(1,0)`. */
export const BIND_MACHINE: Solution = solution([
  sigilPart("bind", ORIGIN.q, ORIGIN.r, 0),
]);

/* -------------------------------------------------------------------------- */
/* Documents a build must refuse                                              */
/* -------------------------------------------------------------------------- */

/** One malformed challenge, and the rule of `specs/formats.md` it breaks. */
export interface MalformedChallenge {
  /** A short name for the failure message, so one sweep tells its cases apart. */
  label: string;
  /** The rule the document breaks, in the specification's own terms. */
  rule: string;
  /** The document itself, typed loosely: it is deliberately not a `Challenge`. */
  document: unknown;
}

/**
 * Challenge documents `loadChallenge` must refuse, each breaking exactly one rule
 * of `specs/formats.md` and otherwise well formed.
 *
 * "A document that is not well formed throws an `Error` naming what is wrong with
 * it and changes nothing" (`specs/instrumentation.md`), so a check hands each of
 * these over, asserts the throw, and asserts that the game is where it was.
 */
export const MALFORMED_CHALLENGES: readonly MalformedChallenge[] = [
  {
    label: "an empty name",
    rule: "`name` is 1 to NAME_MAX (32) characters",
    document: { ...structuredClone(BARE), name: "" },
  },
  {
    label: "a name past NAME_MAX",
    rule: "`name` is 1 to NAME_MAX (32) characters",
    document: { ...structuredClone(BARE), name: "x".repeat(33) },
  },
  {
    label: "no reagents",
    rule: "`reagents` is a non-empty list of molecules",
    document: { ...structuredClone(BARE), reagents: [] },
  },
  {
    label: "no products",
    rule: "`products` is a non-empty list of molecules",
    document: { ...structuredClone(BARE), products: [] },
  },
  {
    label: "an empty molecule",
    rule: "a molecule's `motes` is non-empty",
    document: {
      ...structuredClone(BARE),
      reagents: [{ motes: [], filaments: [] }],
    },
  },
  {
    label: "two motes on one hex",
    rule: "no two mote entries share a hex",
    document: {
      ...structuredClone(BARE),
      reagents: [
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 0, r: 0, type: "nova" },
          ],
          filaments: [],
        },
      ],
    },
  },
  {
    label: "a disconnected molecule",
    rule: "every molecule pattern is connected: one constellation",
    document: {
      ...structuredClone(BARE),
      products: [
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 2, r: 0, type: "dust" },
          ],
          filaments: [],
        },
      ],
    },
  },
  {
    label: "a filament between non-adjacent hexes",
    rule: "a filament's two hexes are adjacent",
    document: {
      ...structuredClone(BARE),
      products: [
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 2, r: 0, type: "dust" },
          ],
          filaments: [{ a: { q: 0, r: 0 }, b: { q: 2, r: 0 }, weight: 1 }],
        },
      ],
    },
  },
  {
    label: "a filament of weight two",
    rule: "a filament's `weight` is 1 or 3",
    document: {
      ...structuredClone(BARE),
      products: [
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 1, r: 0, type: "dust" },
          ],
          filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 2 }],
        },
      ],
    },
  },
  {
    label: "a mote type outside MOTES",
    rule: "each mote's `type` is a member of MOTES",
    document: {
      ...structuredClone(BARE),
      reagents: [{ motes: [{ q: 0, r: 0, type: "quasar" }], filaments: [] }],
    },
  },
  {
    label: "an empty permitted list",
    rule: "`permitted` is non-empty",
    document: { ...structuredClone(BARE), permitted: [] },
  },
  {
    label: "a permitted duplicate",
    rule: "`permitted` holds no duplicates",
    document: { ...structuredClone(BARE), permitted: ["arm", "arm"] },
  },
  {
    label: "a permitted `rise`",
    rule: "each `permitted` entry is a kind of PARTS up to and including `void`",
    document: { ...structuredClone(BARE), permitted: ["arm", "rise"] },
  },
  {
    label: "a tray past TRAY_MAX",
    rule: "the derived tray holds at most TRAY_MAX (16) entries",
    document: {
      ...structuredClone(BARE),
      permitted: [
        "arm",
        "biarm",
        "triarm",
        "hexarm",
        "piston",
        "wheel",
        "track",
        "bind",
        "manifold",
        "triune",
        "sunder",
        "wane",
        "mirror",
        "ascend",
        "conjoin",
      ],
    },
  },
  {
    label: "a target of zero",
    rule: "`target` is a whole number of at least 1",
    document: { ...structuredClone(BARE), target: 0 },
  },
  {
    label: "a `repeat` on a reagent",
    rule: "`repeat` appears on repeating products alone",
    document: {
      ...structuredClone(BARE),
      reagents: [structuredClone(REPEATING_LUNA)],
    },
  },
  {
    label: "a repeat vector of zero",
    rule: "a repeat's `vector` is a non-zero hex offset",
    document: {
      ...structuredClone(BARE),
      products: [
        {
          motes: [{ q: 0, r: 0, type: "luna" }],
          filaments: [],
          repeat: {
            vector: { q: 0, r: 0 },
            link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
          },
        },
      ],
    },
  },
];

/** The tally every shipped challenge asks for, restated for a fixture's reader. */
export const TARGET = CONSTELLATION_TARGET;
