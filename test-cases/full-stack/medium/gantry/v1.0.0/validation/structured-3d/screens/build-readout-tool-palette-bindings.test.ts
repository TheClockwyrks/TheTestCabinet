// screens/build-readout-tool-palette-bindings — the build screen shows all six
// tools, each beside the key that selects it.
//
// specs/ui.md § Build: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool marked,
// and the tape's step count." specs/controls.md fixes the six tools and their
// bindings: `tool-strut` on `Digit1`, `tool-cable` on `Digit2`, `tool-rail` on
// `Digit3`, `tool-ring` on `Digit4`, `tool-counterweight` on `Digit5` and
// `tool-delete` on `Digit6`.
//
// WHAT IS ASSERTED IS THE PAIRING, NOT THE LAYOUT. A palette may run down the
// stage or across it, a build may draw "1 STRUT" as one run or the digit and the
// name as two, and it may set several entries on one line — "1 STRUT   2 CABLE
// 3 RAIL" is one run of text to the recorder and three palette entries to a
// player. So every run is cut into ENTRIES first: at a gap of two or more
// spaces or a separator mark, and, on a line that carries several bindings, at
// each binding digit. Each tool's label is then found among the entries, its
// digit is found either in that same entry or as an entry of its own, and a
// digit drawn on its own is required to sit nearer one of its own tool's labels
// than any other tool's. That is what "each tool's binding" means to a player
// reading the palette, and it holds whichever way the six are arranged.
//
// A LABEL IS A PALETTE ENTRY, NOT A MENTION. A tool's label is an entry whose
// words are exactly a name the tool goes by, with the tool's own binding digit
// or none: `STRUT`, `1 STRUT`, `[1] STRUT`, `STRUT 1`. A line that names the
// tool inside other copy — a status line `SELECTED: STRUT`, a hint, the failure
// copy `THE SLEW RING GAVE WAY`, an issue called `no-ring` — is not a label, so
// it can never stand in for the palette entry and pull a lone digit's ownership
// away from it. Punctuation is stripped before words are read, so a mark set
// beside the selected tool (`> STRUT`, `STRUT ◄`) leaves the label whole.
//
// WHERE AN ENTRY SITS is the run's own anchor when the run is one entry, which
// is the point the build placed it by whatever its alignment; an entry cut out
// of a longer run has no anchor of its own and is placed where it starts along
// the run's measured extent. Ownership is a nearest-point rule between a lone
// digit and the labels, so the reference point matters: a label's centre would
// move a long name's point half its width away from the digit column and hand
// the digit to a shorter name on the row above or below.
//
// THE COPY IS THE BUILD'S, so each tool is matched against a name the tool is
// fairly called rather than against the identifier specs/controls.md uses:
// `ring` is as fairly drawn `SLEW RING` (specs/structure.md § The slew ring),
// `counterweight` as `WEIGHT` or `BALLAST` — "a dense ballast block",
// specs/assets.md — and `delete` as `REMOVE` or `ERASE`.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, type TextDraw } from "../case-harness/index";
import { fail } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/**
 * The six tools in binding order, each with the names it may be labelled by.
 * A name of several words is matched against an entry's words in order.
 */
const TOOLS: readonly { digit: string; names: readonly string[] }[] = [
  { digit: "1", names: ["strut"] },
  { digit: "2", names: ["cable"] },
  { digit: "3", names: ["rail"] },
  { digit: "4", names: ["ring", "slew ring"] },
  { digit: "5", names: ["counterweight", "weight", "ballast"] },
  { digit: "6", names: ["delete", "remove", "erase"] },
];

/**
 * Every run of text the last closed frame drew, with where it landed.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 */
async function frameDraws(harness: Harness) {
  return drawnTextRuns(await harness.screenCalls());
}

/** Letters and digits alone, lowercased. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Where one run of text is cut into entries: a gap of two or more spaces, a
 * tab, or a separator mark a build sets between the entries of one line.
 */
const ENTRY_GAP = /\s{2,}|\t|[·•|/,;]/g;

/** One palette-sized piece of the frame's text. */
interface Entry {
  /** The piece as the frame spells it. */
  readonly text: string;
  /** Its words as `bare` reads them, in order, the binding digit taken out. */
  readonly words: readonly string[];
  /** The one binding digit the piece carries, or none. */
  readonly digit: string | null;
  /** Where the piece sits: its run's anchor, or its start along the run. */
  readonly x: number;
  readonly y: number;
}

/** One word of a run, or one binding digit, and where it starts in the text. */
interface Token {
  readonly word: string;
  readonly digit: boolean;
  readonly start: number;
}

/** The tokens of one piece of a run: single digits apart from words. */
function tokensOf(piece: string, offset: number): Token[] {
  const tokens: Token[] = [];
  for (const token of piece.matchAll(/\S+/g)) {
    const word = bare(token[0]);
    const start = offset + token.index;
    const led = /^(\d)([a-z]+)$/.exec(word);
    const trailed = /^([a-z]+)(\d)$/.exec(word);
    if (word === "") continue;
    if (/^\d$/.test(word)) tokens.push({ word, digit: true, start });
    else if (led !== null) {
      tokens.push({ word: led[1]!, digit: true, start });
      tokens.push({ word: led[2]!, digit: false, start: start + 1 });
    } else if (trailed !== null) {
      tokens.push({ word: trailed[1]!, digit: false, start });
      tokens.push({
        word: trailed[2]!,
        digit: true,
        start: start + trailed[1]!.length,
      });
    } else tokens.push({ word, digit: false, start });
  }
  return tokens;
}

/**
 * The tokens of one piece grouped into entries.
 *
 * A piece that carries several bindings is cut at them: before each digit
 * where the digits lead their names ("1 STRUT 2 CABLE", "TOOLS: 1 STRUT 2
 * CABLE"), after each where they trail ("STRUT 1 CABLE 2"). Which it is reads
 * off the ends of the piece — a digit-led line starts with a digit or ends
 * with a name; a digit-trailed line ends with a digit — since the tokens
 * between the first and last digit alternate the same way under both
 * readings. A piece with one binding or none is one entry, so "STRUT 1" stays
 * whole.
 */
function groupsOf(tokens: Token[]): Token[][] {
  const digits = tokens.filter((token) => token.digit).length;
  if (digits < 2) return tokens.length > 0 ? [tokens] : [];
  const leads = tokens[0]!.digit || !tokens[tokens.length - 1]!.digit;
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    const open = groups[groups.length - 1]!;
    if (leads && token.digit && open.length > 0) groups.push([token]);
    else {
      open.push(token);
      if (!leads && token.digit) groups.push([]);
    }
  }
  return groups.filter((group) => group.length > 0);
}

/** The entries one run of text spells, each placed along the run. */
function entriesOf(run: TextDraw): Entry[] {
  const pieces: { text: string; start: number }[] = [];
  let last = 0;
  for (const gap of run.text.matchAll(ENTRY_GAP)) {
    pieces.push({ text: run.text.slice(last, gap.index), start: last });
    last = gap.index + gap[0].length;
  }
  pieces.push({ text: run.text.slice(last), start: last });

  const cut: {
    text: string;
    words: string[];
    digit: string | null;
    from: number;
  }[] = [];
  for (const piece of pieces) {
    const tokens = tokensOf(piece.text, piece.start);
    for (const group of groupsOf(tokens)) {
      const from = group[0]!.start;
      const next = tokens.find(
        (token) => token.start > group[group.length - 1]!.start,
      );
      const end =
        next === undefined ? piece.start + piece.text.length : next.start;
      const found = group.filter((token) => token.digit);
      cut.push({
        text: run.text.slice(from, end).trim(),
        words: group.filter((token) => !token.digit).map((token) => token.word),
        digit: found.length === 1 ? found[0]!.word : null,
        from,
      });
    }
  }

  // One entry sits at the anchor the build drew the run by. Several share the
  // run's measured extent, each at the point along it where its text starts;
  // without a measured extent every entry stands at the anchor.
  const measured = run.right > run.left && cut.length > 1;
  return cut.map(({ text, words, digit, from }) => ({
    text,
    words,
    digit,
    x: measured
      ? run.left + ((run.right - run.left) * from) / run.text.length
      : run.x,
    y: run.y,
  }));
}

/**
 * Whether `entry` is a palette label for the tool: its words are exactly one
 * of the tool's names, and the binding it carries, if any, is the tool's own.
 */
function labels(
  entry: Entry,
  tool: { digit: string; names: readonly string[] },
): boolean {
  return (
    (entry.digit === null || entry.digit === tool.digit) &&
    tool.names.includes(entry.words.join(" "))
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws all six tools, each beside the digit that selects it", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.advance(1);

  const draws = await frameDraws(h);
  await h.capture("build-palette", "The tool palette");
  const drew = JSON.stringify(draws.map((d) => d.text));

  // Every palette label on the screen, with the tool it labels. A tool may be
  // labelled more than once — a palette and a legend, say — and every label
  // takes part in ownership, so which one is met first in draw order decides
  // nothing.
  const entries = draws.flatMap(entriesOf);
  const labelled = entries.flatMap((entry) =>
    TOOLS.flatMap((tool, at) => (labels(entry, tool) ? [{ entry, at }] : [])),
  );

  for (const [at, tool] of TOOLS.entries()) {
    if (!labelled.some((label) => label.at === at)) {
      fail(
        `the tool palette to name the ${tool.names[0]} tool ` +
          "(specs/ui.md § Build)",
        `the build screen drew ${drew}`,
      );
    }
  }

  // The label a lone digit sits nearest, which is the tool a player reads that
  // binding as belonging to.
  const owner = (draw: { x: number; y: number }) =>
    labelled.reduce((best, label) =>
      Math.hypot(label.entry.x - draw.x, label.entry.y - draw.y) <
      Math.hypot(best.entry.x - draw.x, best.entry.y - draw.y)
        ? label
        : best,
    );

  for (const [at, tool] of TOOLS.entries()) {
    // A binding drawn inside a label's own entry needs no position at all.
    if (labelled.some((label) => label.at === at && label.entry.digit !== null))
      continue;

    const digits = entries.filter(
      (entry) => entry.words.length === 0 && entry.digit === tool.digit,
    );
    if (digits.length === 0) {
      fail(
        `the tool palette to draw the binding "${tool.digit}" that selects ` +
          `the ${tool.names[0]} tool (specs/ui.md § Build, ` +
          "specs/controls.md § The actions)",
        `the build screen drew ${drew}`,
      );
    }
    if (!digits.some((digit) => owner(digit).at === at)) {
      fail(
        `the binding "${tool.digit}" to be drawn beside the ` +
          `${tool.names[0]} tool it selects, nearer that tool's name than ` +
          "any other's (specs/ui.md § Build, specs/controls.md § The actions)",
        `every "${tool.digit}" the screen drew sits nearest ` +
          JSON.stringify(digits.map((digit) => owner(digit).entry.text)),
      );
    }
  }
});
