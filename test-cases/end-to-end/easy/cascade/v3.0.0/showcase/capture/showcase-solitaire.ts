// Cascade — the showcase player's own model of the game, and the search that
// plans a solve through it. CAPTURE-ONLY: this file is never staged into a run
// and no validator imports it.
//
// WHAT THIS IS FOR. The showcase's leading clip is a real game of Cascade played
// from a real deal to the victory cascade, driven with the real mouse against the
// reference build. A game of Klondike is only winnable if it is played well, so
// the player needs a PLAN before it touches the pointer — which card to lift,
// where to put it, and when to turn the stock — and this is where that plan comes
// from.
//
// THE PLAN IS A PROPOSAL, NOT AN OUTCOME. Nothing here ever touches the game. The
// search below runs over a model of Klondike written from `specs/` (the same
// rules `src/rules.ts` and `src/board.ts` implement), decides a sequence of
// ordinary player gestures, and hands it to the driver — which performs each one
// with the real mouse and then reads `snapshot()` to check that the game did what
// the plan expected. A plan the build's own rules refuse fails the capture. So the
// model here can only ever propose; the build decides, and what is on screen is
// always the build's own answer.
//
// The model deliberately restates the rules rather than importing the build's,
// because the driver runs against a page rather than a module: `references/none/`
// is a static site and there is nothing to import. The deal is restated for the
// same reason, and {@link dealFor} is checked against the game's own deal at
// capture time — the driver refuses to play if the two disagree.
//
// PERFECT KNOWLEDGE IS DELIBERATE. The search plans against the whole deal, the
// face-down cards included, which `snapshot()` reports and a human player cannot
// see. That is what makes a solve findable at all ("thoughtful" Klondike), and it
// changes nothing about what reaches the screen: every move in the plan is a
// gesture a player could make, and the game accepts or refuses it on its own
// rules either way.

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

/** The suits in the order `specs/deal.md` fixes, which is the deck's order. */
export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

/** A card as a number: `suit * 13 + rank - 1`, so `0..51` is the whole deck. */
export type Code = number;

export const RANK_MAX = 13;
export const DECK_SIZE = 52;
export const COLUMNS = 7;

export function suitOf(code: Code): number {
  return Math.floor(code / RANK_MAX);
}

export function rankOf(code: Code): number {
  return (code % RANK_MAX) + 1;
}

/** `0` for black (spades, clubs) and `1` for red (hearts, diamonds). */
export function colorOf(code: Code): number {
  const suit = suitOf(code);
  return suit === 1 || suit === 2 ? 1 : 0;
}

export function codeOf(suit: Suit, rank: number): Code {
  return SUITS.indexOf(suit) * RANK_MAX + rank - 1;
}

/** A card as it reads in a log: `AS`, `TD`, `QH`. */
export function nameOf(code: Code): string {
  const rank = "A23456789TJQK"[rankOf(code) - 1];
  return `${rank}${"SHDC"[suitOf(code)]}`;
}

/* -------------------------------------------------------------------------- */
/* The deal (specs/deal.md, mirroring src/rng.ts and src/deck.ts)              */
/* -------------------------------------------------------------------------- */

/** The deal a seed produces: seven columns bottom-to-top, and the stock. */
export interface Deal {
  /** Column `i` holds `i + 1` cards; all but the last are face-down. */
  columns: Code[][];
  /** Bottom to top, so the last entry is the card the first turn takes. */
  stock: Code[];
}

/** mulberry32, as `src/rng.ts` states it. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const a = (state + 0x6d2b79f5) | 0;
    state = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The deal a seed produces, by the same shuffle and the same dealing order the
 * build uses.
 *
 * `orderedDeck()` is suit by suit and Ace to King within each, which is exactly
 * the code order above; the shuffle is Fisher-Yates from the top down, drawing
 * each index from the generator; the deal fills column by column, then the
 * stock.
 */
export function dealFor(seed: number): Deal {
  const deck: Code[] = Array.from({ length: DECK_SIZE }, (_, i) => i);
  const next = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const swap = deck[i];
    deck[i] = deck[j];
    deck[j] = swap;
  }
  const columns: Code[][] = [];
  let at = 0;
  for (let column = 0; column < COLUMNS; column += 1) {
    const cards: Code[] = [];
    for (let row = 0; row <= column; row += 1) {
      cards.push(deck[at]);
      at += 1;
    }
    columns.push(cards);
  }
  const stock: Code[] = [];
  for (let i = 0; i < DECK_SIZE - at; i += 1) {
    stock.push(deck[at + i]);
  }
  return { columns, stock };
}

/* -------------------------------------------------------------------------- */
/* The state the search walks                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One position.
 *
 * `down[i]` is how many of column `i`'s cards are face-down; they are its first
 * `down[i]` entries, and the rest are face-up. The waste's SET MEMORY is not
 * modelled because it decides nothing here: in real play the sets partition the
 * waste exactly (every turn pushes a set of what it turned, every play off the
 * waste takes one from the newest set that holds any), so the waste's top card is
 * playable whenever the waste holds a card at all. What the memory decides is
 * what the waste SHOWS, which is the build's business and not the plan's.
 */
export interface Position {
  columns: Code[][];
  down: number[];
  /** Top rank on each suit's foundation, `0` when that suit has none home. */
  foundations: number[];
  /** Bottom to top; the top card is the last, and is what a turn takes. */
  stock: Code[];
  /** Bottom to top; the top card is the last, and is the only playable one. */
  waste: Code[];
}

export function positionFor(deal: Deal): Position {
  return {
    columns: deal.columns.map((column) => [...column]),
    down: deal.columns.map((column) => column.length - 1),
    foundations: [0, 0, 0, 0],
    stock: [...deal.stock],
    waste: [],
  };
}

function clone(position: Position): Position {
  return {
    columns: position.columns.map((column) => [...column]),
    down: [...position.down],
    foundations: [...position.foundations],
    stock: [...position.stock],
    waste: [...position.waste],
  };
}

export function cardsHome(position: Position): number {
  return position.foundations.reduce((sum, rank) => sum + rank, 0);
}

export function isWin(position: Position): boolean {
  return position.foundations.every((rank) => rank === RANK_MAX);
}

/* -------------------------------------------------------------------------- */
/* Moves                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One gesture the player will make.
 *
 * Each is a thing a pointer can do on the table: a click on the stock, a
 * double-click that sends a card home, or a drag of a run from one pile to
 * another. The driver turns each into a real mouse gesture; nothing here names a
 * debug operation.
 */
export type Move =
  | { kind: "turn" }
  | { kind: "waste-home" }
  | { kind: "waste-column"; to: number }
  | { kind: "column-home"; from: number }
  | { kind: "column-column"; from: number; count: number; to: number };

export function describe(move: Move): string {
  switch (move.kind) {
    case "turn":
      return "turn the stock";
    case "waste-home":
      return "waste home";
    case "waste-column":
      return `waste to column ${move.to}`;
    case "column-home":
      return `column ${move.from} home`;
    case "column-column":
      return `${move.count} from column ${move.from} to column ${move.to}`;
  }
}

/** Whether a foundation holding `top` (0 for empty) accepts `code`. */
function foundationTakes(top: number, code: Code): boolean {
  return rankOf(code) === top + 1;
}

/** Whether a column whose cards are `column` accepts a run led by `lead`. */
function columnTakes(position: Position, index: number, lead: Code): boolean {
  const column = position.columns[index];
  const size = column.length;
  if (size === 0) return rankOf(lead) === RANK_MAX;
  const lowest = column[size - 1];
  if (size <= position.down[index]) return false;
  return (
    colorOf(lowest) !== colorOf(lead) && rankOf(lowest) === rankOf(lead) + 1
  );
}

/** The length of the ordered face-up run at the bottom of column `index`. */
function runLength(position: Position, index: number): number {
  const column = position.columns[index];
  const down = position.down[index];
  let length = 0;
  for (let row = column.length - 1; row >= down; row -= 1) {
    if (row < column.length - 1) {
      const below = column[row + 1];
      const above = column[row];
      if (rankOf(below) !== rankOf(above) - 1) break;
      if (colorOf(below) === colorOf(above)) break;
    }
    length += 1;
  }
  return length;
}

/**
 * Apply `move` in place. Returns `false` when the rules refuse it, having
 * changed nothing.
 *
 * The bookkeeping an accepted move owes is here too, because the game owes it:
 * a source column left with a face-down card lowest turns that card over.
 */
export function apply(
  position: Position,
  move: Move,
  turnCount: number,
): boolean {
  const flip = (index: number): void => {
    if (
      position.down[index] > 0 &&
      position.columns[index].length === position.down[index]
    ) {
      position.down[index] -= 1;
    }
  };
  switch (move.kind) {
    case "turn": {
      if (position.stock.length > 0) {
        const count = Math.min(turnCount, position.stock.length);
        for (let i = 0; i < count; i += 1) {
          position.waste.push(position.stock.pop() as Code);
        }
        return true;
      }
      if (position.waste.length === 0) return false;
      while (position.waste.length > 0) {
        position.stock.push(position.waste.pop() as Code);
      }
      return true;
    }
    case "waste-home": {
      const card = position.waste[position.waste.length - 1];
      if (card === undefined) return false;
      const suit = suitOf(card);
      if (!foundationTakes(position.foundations[suit], card)) return false;
      position.waste.pop();
      position.foundations[suit] = rankOf(card);
      return true;
    }
    case "waste-column": {
      const card = position.waste[position.waste.length - 1];
      if (card === undefined) return false;
      if (!columnTakes(position, move.to, card)) return false;
      position.waste.pop();
      position.columns[move.to].push(card);
      return true;
    }
    case "column-home": {
      const column = position.columns[move.from];
      const card = column[column.length - 1];
      if (card === undefined) return false;
      if (column.length <= position.down[move.from]) return false;
      const suit = suitOf(card);
      if (!foundationTakes(position.foundations[suit], card)) return false;
      column.pop();
      position.foundations[suit] = rankOf(card);
      flip(move.from);
      return true;
    }
    case "column-column": {
      const column = position.columns[move.from];
      const start = column.length - move.count;
      if (start < position.down[move.from]) return false;
      const lead = column[start];
      if (lead === undefined) return false;
      if (!columnTakes(position, move.to, lead)) return false;
      const run = column.splice(start, move.count);
      position.columns[move.to].push(...run);
      flip(move.from);
      return true;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The search                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether sending `code` home can never be regretted.
 *
 * The standard safe rule: an Ace or a Two always, and otherwise only once both
 * foundations of the opposite colour are within one of it and the other
 * foundation of its own colour is within two — at which point no card left on
 * the table can still need it as a landing place. Playing these without asking
 * cuts the branching factor hard and cannot lose a game that was winnable.
 */
function safeHome(position: Position, code: Code): boolean {
  const rank = rankOf(code);
  if (rank <= 2) return true;
  const suit = suitOf(code);
  // Suit order is spades, hearts, diamonds, clubs: 0 and 3 are black, 1 and 2 red.
  const opposite = colorOf(code) === 0 ? [1, 2] : [0, 3];
  const same = colorOf(code) === 0 ? (suit === 0 ? 3 : 0) : suit === 1 ? 2 : 1;
  const [a, b] = opposite;
  return (
    position.foundations[a] >= rank - 1 &&
    position.foundations[b] >= rank - 1 &&
    position.foundations[same] >= rank - 2
  );
}

/** Every safe foundation move available now, taken until none is left. */
function drainSafe(position: Position, turnCount: number, plan: Move[]): void {
  for (;;) {
    let moved = false;
    const waste = position.waste[position.waste.length - 1];
    if (
      waste !== undefined &&
      foundationTakes(position.foundations[suitOf(waste)], waste) &&
      safeHome(position, waste)
    ) {
      apply(position, { kind: "waste-home" }, turnCount);
      plan.push({ kind: "waste-home" });
      moved = true;
    }
    for (let index = 0; index < COLUMNS; index += 1) {
      const column = position.columns[index];
      const card = column[column.length - 1];
      if (card === undefined) continue;
      if (column.length <= position.down[index]) continue;
      if (!foundationTakes(position.foundations[suitOf(card)], card)) continue;
      if (!safeHome(position, card)) continue;
      apply(position, { kind: "column-home", from: index }, turnCount);
      plan.push({ kind: "column-home", from: index });
      moved = true;
    }
    if (!moved) return;
  }
}

/** A key that names this position exactly, for the closed set. */
function keyOf(position: Position): string {
  const columns = position.columns
    .map((column, index) => `${position.down[index]}:${column.join(",")}`)
    .join("/");
  return `${columns}|${position.foundations.join(",")}|${position.stock.join(",")}|${position.waste.join(",")}`;
}

/**
 * The fewest gestures that could possibly finish from here.
 *
 * Two disjoint counts, so their sum is still a lower bound and the search that
 * uses it never rejects a plan shorter than one it has found. Every card not yet
 * home costs at least the one gesture that sends it home; and every card still in
 * the stock costs at least its share of a turn before it can be played at all,
 * since a turn moves at most `turnCount` cards onto the waste. A turn is never a
 * foundation move, so nothing is counted twice.
 */
function remaining(position: Position, turnCount: number): number {
  return (
    DECK_SIZE -
    cardsHome(position) +
    Math.ceil(position.stock.length / turnCount)
  );
}

/**
 * The candidate moves from this position, best first.
 *
 * The ordering is the whole of the search's cleverness, and it is the ordering a
 * good player uses: turn over a face-down card when you can, and take it from the
 * column with the fewest left to dig through, since that is the column that can
 * be emptied; get the waste's card onto the table before the next turn buries it;
 * strip a column bare only when a King is waiting for the space; and turn the
 * stock last, because a turn buys nothing on its own.
 */
function candidates(position: Position): Move[] {
  const scored: { move: Move; score: number }[] = [];
  const waste = position.waste[position.waste.length - 1];

  // A King that is not already leading a column of its own is a King that wants
  // an empty one, and a King still in the stock or the waste will want one when
  // it arrives. Only a table whose four Kings all lead columns wants no space.
  const settledKings = position.columns.filter(
    (column) => column.length > 0 && rankOf(column[0]) === RANK_MAX,
  ).length;
  const wantsColumn = settledKings < 4;

  // Unsafe foundation plays. The safe ones have already been taken.
  if (
    waste !== undefined &&
    foundationTakes(position.foundations[suitOf(waste)], waste)
  ) {
    scored.push({ move: { kind: "waste-home" }, score: 40 });
  }
  for (let index = 0; index < COLUMNS; index += 1) {
    const column = position.columns[index];
    const card = column[column.length - 1];
    if (card === undefined || column.length <= position.down[index]) continue;
    if (!foundationTakes(position.foundations[suitOf(card)], card)) continue;
    const exposes = column.length - 1 === position.down[index];
    scored.push({
      move: { kind: "column-home", from: index },
      score: exposes ? 90 : 45,
    });
  }

  // Runs between columns.
  for (let from = 0; from < COLUMNS; from += 1) {
    const column = position.columns[from];
    const down = position.down[from];
    const longest = runLength(position, from);
    if (longest === 0) continue;
    for (let count = 1; count <= longest; count += 1) {
      const start = column.length - count;
      const lead = column[start];
      const empties = start === 0;
      const uncovers = start === down && down > 0;
      // Moving a whole face-up column onto another achieves nothing unless it
      // empties the column for a King that is waiting for one.
      if (empties && !wantsColumn) continue;
      for (let to = 0; to < COLUMNS; to += 1) {
        if (to === from) continue;
        if (!columnTakes(position, to, lead)) continue;
        const score = uncovers ? 100 - down : empties ? 60 : 30;
        scored.push({
          move: { kind: "column-column", from, count, to },
          score,
        });
      }
    }
  }

  // The waste onto the table.
  if (waste !== undefined) {
    for (let to = 0; to < COLUMNS; to += 1) {
      if (!columnTakes(position, to, waste)) continue;
      scored.push({
        move: { kind: "waste-column", to },
        score: position.columns[to].length === 0 ? 55 : 50,
      });
    }
  }

  // And, last, the stock.
  if (position.stock.length > 0 || position.waste.length > 0) {
    scored.push({ move: { kind: "turn" }, score: 10 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.move);
}

/* ---- The queue ------------------------------------------------------------ */

interface Node {
  position: Position;
  /** Gestures made to reach this position. */
  cost: number;
  /** `cost + weight * remaining`, which is what the queue orders on. */
  rank: number;
  /** Where this came from, so the plan can be read back off the winner. */
  parent: Node | null;
  /** The gestures the parent made to get here: the chosen one, then the safe ones. */
  moves: Move[];
  /** A tie-break that prefers the position that has got further. */
  home: number;
}

/** A plain binary heap over {@link Node.rank}, smallest first. */
class Queue {
  private readonly items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  private before(a: Node, b: Node): boolean {
    if (a.rank !== b.rank) return a.rank < b.rank;
    // Between two positions the search rates equally, take the one that has more
    // cards home: it is the one nearer a finish, and preferring it turns a broad
    // frontier into a line of play.
    return a.home > b.home;
  }

  push(node: Node): void {
    this.items.push(node);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(this.items[at], this.items[parent])) break;
      [this.items[at], this.items[parent]] = [
        this.items[parent],
        this.items[at],
      ];
      at = parent;
    }
  }

  pop(): Node | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let best = at;
        if (
          left < this.items.length &&
          this.before(this.items[left], this.items[best])
        ) {
          best = left;
        }
        if (
          right < this.items.length &&
          this.before(this.items[right], this.items[best])
        ) {
          best = right;
        }
        if (best === at) break;
        [this.items[at], this.items[best]] = [this.items[best], this.items[at]];
        at = best;
      }
    }
    return top;
  }
}

export interface SearchLimits {
  /** The longest plan worth having, counted in gestures. */
  maxMoves: number;
  /** How many positions to expand before giving this deal up. */
  maxNodes: number;
  /**
   * How much the search leans on its estimate of what is left.
   *
   * `1` is a plain A* and returns the shortest plan there is, at a cost that
   * makes it useless here; above `1` the search commits to progress and returns a
   * plan that is longer than optimal by at most that factor. The showcase wants a
   * SHORT solve rather than the shortest one, and around `1.6` finds one in a
   * second or two.
   */
  weight: number;
}

export interface SearchResult {
  plan: Move[] | null;
  nodes: number;
}

/**
 * Plan a win from `deal`, or answer that none was found inside the limits.
 *
 * A weighted A* over positions, with the safe foundation plays taken as part of
 * whichever gesture opened them, so the frontier holds only real decisions. The
 * plan it returns is bounded in LENGTH as well as in effort, because a plan is
 * only useful to the showcase if the clip can hold it: a search allowed to wander
 * finds a win of three hundred gestures that nobody would want to watch.
 */
export function solve(
  deal: Deal,
  turnCount: number,
  limits: SearchLimits,
): SearchResult {
  const start = positionFor(deal);
  const opening: Move[] = [];
  drainSafe(start, turnCount, opening);

  const seen = new Map<string, number>();
  const queue = new Queue();
  const root: Node = {
    position: start,
    cost: opening.length,
    rank: opening.length + limits.weight * remaining(start, turnCount),
    parent: null,
    moves: opening,
    home: cardsHome(start),
  };
  queue.push(root);
  seen.set(keyOf(start), root.cost);

  let nodes = 0;
  while (queue.size > 0) {
    const node = queue.pop() as Node;
    if (isWin(node.position)) {
      const plan: Move[] = [];
      for (let at: Node | null = node; at !== null; at = at.parent) {
        plan.unshift(...at.moves);
      }
      return { plan, nodes };
    }
    if (nodes >= limits.maxNodes) break;
    nodes += 1;

    for (const move of candidates(node.position)) {
      const next = clone(node.position);
      if (!apply(next, move, turnCount)) continue;
      const moves: Move[] = [move];
      drainSafe(next, turnCount, moves);
      const cost = node.cost + moves.length;
      if (cost + remaining(next, turnCount) > limits.maxMoves) continue;
      const key = keyOf(next);
      const best = seen.get(key);
      if (best !== undefined && best <= cost) continue;
      seen.set(key, cost);
      queue.push({
        position: next,
        cost,
        rank: cost + limits.weight * remaining(next, turnCount),
        parent: node,
        moves,
        home: cardsHome(next),
      });
    }
  }
  return { plan: null, nodes };
}
