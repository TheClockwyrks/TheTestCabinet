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
// stage or across it, and a build may draw "1 STRUT" as one run or the digit and
// the name as two. So each tool's name is found among the frame's runs, each
// digit is found either in that same run or as a run of its own, and a digit
// drawn on its own is required to sit nearer its own tool's name than any other
// tool's. That is what "each tool's binding" means to a player reading the
// palette, and it holds whichever way the six are arranged.
//
// THE COPY IS THE BUILD'S, so each tool is matched against a word the tool is
// named by rather than against the identifier specs/controls.md uses:
// `counterweight` is as fairly drawn `WEIGHT`, and `delete` as `REMOVE`.

import { afterEach, beforeEach, it } from "vitest";
import { textDraws, toDrawCall, type RecordedOp } from "../case-harness/index";
import { fail } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The page global the shared harness installs its draw recorder on. */
const RECORDER = "__tcabRec";

/** The six tools in binding order, each with the words it may be named by. */
const TOOLS: readonly { digit: string; names: readonly string[] }[] = [
  { digit: "1", names: ["strut"] },
  { digit: "2", names: ["cable"] },
  { digit: "3", names: ["rail"] },
  { digit: "4", names: ["ring"] },
  { digit: "5", names: ["counterweight", "weight"] },
  { digit: "6", names: ["delete", "remove", "erase"] },
];

/** Every run of text the last closed frame drew, with where it landed. */
async function frameDraws(harness: Harness) {
  const ops = (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
  return textDraws(ops.map(toDrawCall));
}

/** Letters and digits alone, lowercased. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  await clearAll(h);
  await h.advance(1);

  const draws = await frameDraws(h);
  await h.capture("build-palette", "The tool palette");
  const drew = JSON.stringify(draws.map((d) => d.text));

  // Each tool's label: the run whose whole text is one of the tool's names, so a
  // name inside longer copy — an issue called `no-ring`, a hint line — is not
  // mistaken for the palette entry.
  const labels = TOOLS.map(({ digit, names }) =>
    draws.find((draw) =>
      names.some(
        (name) => bare(draw.text) === name || bare(draw.text) === digit + name,
      ),
    ),
  );

  for (const [index, label] of labels.entries()) {
    if (label === undefined) {
      fail(
        `the tool palette to name the ${TOOLS[index]!.names[0]} tool ` +
          "(specs/ui.md § Build)",
        `the build screen drew ${drew}`,
      );
    }
  }

  // Which tool's name a run sits nearest, which is the tool a player reads that
  // binding as belonging to.
  const owner = (draw: { x: number; y: number }): number =>
    labels.reduce(
      (best, other, at) =>
        Math.hypot(other!.x - draw.x, other!.y - draw.y) <
        Math.hypot(labels[best]!.x - draw.x, labels[best]!.y - draw.y)
          ? at
          : best,
      0,
    );

  for (const [index, tool] of TOOLS.entries()) {
    // The binding drawn inside the label's own run needs no position at all.
    if (bare(labels[index]!.text).includes(tool.digit)) continue;

    const digits = draws.filter((draw) => bare(draw.text) === tool.digit);
    if (digits.length === 0) {
      fail(
        `the tool palette to draw the binding "${tool.digit}" that selects ` +
          `the ${tool.names[0]} tool (specs/ui.md § Build, ` +
          "specs/controls.md § The actions)",
        `the build screen drew ${drew}`,
      );
    }
    if (!digits.some((digit) => owner(digit) === index)) {
      fail(
        `the binding "${tool.digit}" to be drawn beside the ` +
          `${tool.names[0]} tool it selects, nearer that tool's name than ` +
          "any other's (specs/ui.md § Build, specs/controls.md § The actions)",
        `every "${tool.digit}" the screen drew sits nearest ` +
          JSON.stringify(digits.map((digit) => labels[owner(digit)]!.text)),
      );
    }
  }
});
