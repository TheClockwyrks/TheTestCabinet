// screens/howto-names-keys — how to play names the keys.
//
// specs/screens.md, on `howto`: it covers "the controls, naming the keys bound
// to each action in `specs/controls.md`", "written in a player's words rather
// than as rules of a system" — so a player reads the controls off the screen.
//
// The copy is the build's to write, so each action passes when the frame names
// at least one of its bound keys in any spelling a player would read it by:
// the four directional actions by an arrow — as a group or as the one arrow
// that fires the action — by one of its glyphs, by the WASD cluster or a pair
// out of it, by the code spelling the specs table itself uses (`KeyA`), or by
// the bare letter standing in its own column beside its action on one drawn
// line — and the rest by their key's name in either spelling.
//
// HOW AN ARROW MENTION IS READ. An arrow carries the directions written
// beside it, in whichever order and spelling the copy uses: "ArrowUp" and
// "Arrow Up" are the code spelling, "the up arrow" is how a person writes the
// same key, and "the left and right arrows" is how a person names two of them
// at once. A mention with no direction beside it — "the arrow keys", "the
// arrows" — is the group and names all four. A direction only counts when it
// runs up to the arrow through nothing but other directions and the words
// that join them, so "move up or down with the arrow keys" reads as the group
// rather than as "down" alone. A BARE "ARROW" therefore never names one key
// in particular, and a build whose only arrows are "the left and right
// arrows" has named no up key and no down key.
//
// WHY THE PAIRING IS READ ALONG A BASELINE. A two-column list, "W  UP" over
// "S  DOWN", names its keys as plainly as "the arrow keys" does and names no
// arrow, no cluster and no code. A build draws such a list as two calls a
// column apart, which never coalesce into one logical run, so the runs are
// grouped back into the line a player reads and the pairing is read over
// that; across the whole copy at once a bare letter would meet an action word
// it was never beside. The letter must stand in a COLUMN of its own — at the
// head or tail of the line, or set off by a gap or a separator — because "a"
// is an English word as well as a key, and "costs a life" on a line that also
// says "left" names nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  RUN_BASELINE_SLACK,
  drawnTextLines,
  drawnTextRuns,
} from "../case-harness/text";
import {
  captureStill,
  drawnText,
  openHarness,
  poseScene,
  type DrawCall,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The four directional actions, by the word their arrow is named with. */
const DIRECTIONS = ["left", "right", "up", "down"] as const;

type Direction = (typeof DIRECTIONS)[number];

/** The words and marks that join one direction to the next in a list. */
const JOINERS = new Set(["and", "or", "&", "/", ",", "+", "-"]);

/** An arrow written as one word with its direction: `ArrowUp`, `uparrow`. */
const JOINED_ARROW =
  /^(?:arrows?(left|right|up|down)|(left|right|up|down)arrows?)$/u;

/** One action, and every spelling that counts as naming one of its keys. */
interface Named {
  /** The action and its bound keys, for the failure message. */
  action: string;
  /** The direction whose arrow fires this action, for the arrow reading. */
  direction?: Direction;
  /** Read against the whole frame's copy, lowercased. */
  any: RegExp;
  /**
   * Read against the copy with its case INTACT, for the `KeyboardEvent.code`
   * spelling the specs table itself uses. Case matters for exactly one of
   * them: lowercased, `KeyS` is the ordinary plural in "the arrow keys".
   */
  code?: RegExp;
  /**
   * A key named as a bare letter beside the action it fires, on ONE drawn
   * line — "W  UP", "A  rotate left". A two-column key-and-action list is an
   * ordinary way to write this screen and names no arrow and no cluster, so
   * the pairing is read line by line, with the letter standing in a column of
   * its own.
   */
  pair?: { letter: string; word: RegExp };
}

/**
 * The directional actions are named by the arrows (see the header), by one of
 * the glyphs, by the WASD cluster or a pair out of it, by the `Key*` code, or
 * by the bare letter standing beside its action on one line. `left` and
 * `right` share a pair spelling ("A / D"), as `up` and `down` do ("W / S");
 * either names both.
 */
const NAMED: readonly Named[] = [
  {
    action: "left (ArrowLeft / KeyA)",
    direction: "left",
    any: /[\u2190\u25c0\u25c4]|wasd|keya|\ba\s*[/,|]\s*d\b/u,
    code: /KeyA/,
    pair: { letter: "a", word: /\bleft\b/ },
  },
  {
    action: "right (ArrowRight / KeyD)",
    direction: "right",
    any: /[\u2192\u25b6\u25ba]|wasd|keyd|\ba\s*[/,|]\s*d\b/u,
    code: /KeyD/,
    pair: { letter: "d", word: /\bright\b/ },
  },
  {
    action: "up (ArrowUp / KeyW)",
    direction: "up",
    any: /[\u2191\u25b2\u25b4]|wasd|keyw|\bw\s*[/,|]\s*s\b/u,
    code: /KeyW/,
    pair: { letter: "w", word: /\bup\b/ },
  },
  {
    action: "down (ArrowDown / KeyS)",
    direction: "down",
    any: /[\u2193\u25bc\u25be]|wasd|\bw\s*[/,|]\s*s\b/u,
    code: /KeyS/,
    pair: { letter: "s", word: /\bdown\b/ },
  },
  { action: "confirm (Space / Enter)", any: /space|enter|return/ },
  { action: "launch (Space)", any: /space/ },
  { action: "back (Escape)", any: /esc/ },
  { action: "pause (KeyP)", any: /\bp\b|keyp/ },
];

/** Whether `word` is one of the four directions. */
function isDirection(word: string): word is Direction {
  return (DIRECTIONS as readonly string[]).includes(word);
}

/**
 * Which directions one piece of copy's arrow mentions name.
 *
 * Read outward from each "arrow": the token beside it must itself be a
 * direction for the mention to be qualified at all, and from there directions
 * and the words joining them are followed to the end of the list. An
 * unqualified mention is the group and names all four.
 */
function arrowsIn(copy: string): Set<Direction> {
  const named = new Set<Direction>();
  const tokens = copy.match(/[a-z]+|[/,&+-]/gu) ?? [];
  tokens.forEach((token, at) => {
    const joined = JOINED_ARROW.exec(token);
    if (joined !== null) {
      named.add((joined[1] ?? joined[2]) as Direction);
      return;
    }
    if (token !== "arrow" && token !== "arrows") return;
    const beside = new Set<Direction>();
    for (const step of [-1, 1]) {
      for (let i = at + step; i >= 0 && i < tokens.length; i += step) {
        const word = tokens[i] as string;
        if (isDirection(word)) {
          beside.add(word);
          continue;
        }
        if (i !== at + step && JOINERS.has(word)) continue;
        break;
      }
    }
    for (const direction of beside.size === 0 ? DIRECTIONS : beside) {
      named.add(direction);
    }
  });
  return named;
}

/** Which directions the frame's copy names, read over each piece separately. */
function arrowsNamed(pieces: readonly string[]): ReadonlySet<Direction> {
  const named = new Set<Direction>();
  for (const piece of pieces) {
    for (const direction of arrowsIn(piece)) named.add(direction);
  }
  return named;
}

/** What sets a key's column off from the copy around it on one line. */
const COLUMN_BEFORE = "^|\\s{2,}|[-\\u2013\\u2014:|/,()\\[\\]]\\s*";
const COLUMN_AFTER = "$|\\s{2,}|\\s*[-\\u2013\\u2014:|/,()\\[\\]]";

/** Whether `line` stands `letter` in a column of its own, as a key. */
function inKeyColumn(letter: string, line: string): boolean {
  return new RegExp(
    `(?:${COLUMN_BEFORE})${letter}(?:${COLUMN_AFTER})`,
    "u",
  ).test(line);
}

/**
 * The frame's text runs joined into one line per baseline, the runs of a line
 * set two spaces apart.
 *
 * `drawnTextLines` spells LOGICAL RUNS, and a two-column list draws the key
 * and its action as two calls a column apart, which never merge into one run —
 * read off the runs, the letter never meets its word. The runs sharing a
 * baseline are the line a player reads, and the two-space join keeps the gap
 * between two columns a gap, so a key standing in its own column reads as a
 * key while a bare "a" inside a sentence stays the indefinite article.
 */
function baselineLines(calls: readonly DrawCall[]): string[] {
  const lines: string[] = [];
  let baseline: number | undefined;
  for (const run of drawnTextRuns(calls)) {
    if (
      baseline !== undefined &&
      Math.abs(run.y - baseline) <= RUN_BASELINE_SLACK
    ) {
      lines[lines.length - 1] += `  ${run.text}`;
      continue;
    }
    lines.push(run.text);
    baseline = run.y;
  }
  return lines;
}

/** Whether the frame's copy names one of `named`'s keys. */
function names(
  named: Named,
  copy: string,
  cased: string,
  lines: readonly string[],
  arrows: ReadonlySet<Direction>,
): boolean {
  if (named.direction !== undefined && arrows.has(named.direction)) return true;
  if (named.any.test(copy)) return true;
  if (named.code !== undefined && named.code.test(cased)) return true;
  const pair = named.pair;
  if (pair === undefined) return false;
  return lines.some(
    (line) => inKeyColumn(pair.letter, line) && pair.word.test(line),
  );
}

it("names a key for every action on the how-to frame", async () => {
  const posed = await poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the copy is read from");

  const { calls } = await h.frameDraw();
  await captureStill(h, "howto");

  // Both the raw strings and the logical runs they spell
  // (`case-harness/text.ts`): a build that letter-spaces this screen draws one
  // glyph per call, and only the coalesced run reads as the key it names —
  // while a run that fuses a key with the label beside it could hide a
  // `\b`-bounded key the raw call still shows. Together they only add matches.
  const cased = [...drawnText(calls), ...drawnTextLines(calls)].join(" ");
  const text = cased.toLowerCase();
  const lines = baselineLines(calls).map((line) => line.toLowerCase());
  // An arrow is read over each piece of copy on its own rather than over the
  // join, so a direction ending one line cannot qualify an arrow opening the
  // next.
  const arrows = arrowsNamed([
    ...lines,
    ...drawnText(calls).map((raw) => raw.toLowerCase()),
  ]);
  for (const named of NAMED) {
    if (names(named, text, cased, lines, arrows)) continue;
    fail(`the how-to copy naming a key for ${named.action}`, text);
  }
});
