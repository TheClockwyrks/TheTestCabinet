// What an agent's context window was *made of*, and what that material cost.
//
// The context graph says how many tokens each band held at a point in time, and the Cost
// widget says what the whole scope spent. Neither answers the question an operator tuning a
// gg configuration actually asks: **which material drove the bill** — which file sat in the
// window for eighty turns, which tool returned output nobody read again, whether the
// autoloaded specifications are worth what they cost. This module answers it by folding the
// message log the way the provider bills it.
//
// # How a turn's spend is attributed
//
// gg's window is append-only: a turn *re-sends* everything still in it, so a message's cost
// is not what it cost to bring in once — it is its size multiplied by every turn it
// survived. That is why a 12k-token specification read on turn 2 of a 90-turn run can
// outspend every other thing in the window put together, and why a per-message token figure
// alone (which the Requests view already gives) does not show it.
//
// So the fold walks the run turn by turn. For each turn it takes the **actual** input tokens
// the provider reported (uncached + cached) and the input cost those tokens carry at the
// agent's model's catalog rates, then splits both across the turn's request messages in
// proportion to each message's estimated share of that request. Summing per message — and
// then per band, per view, and per tool — gives what each is answerable for across the whole
// run, grounded in reported usage rather than in estimates alone.
//
// Two figures come out of that, and they mean different things:
//
// - **tokens** — the material's own size, each distinct message counted once. What it costs
//   to *bring in*.
// - **billed tokens** (and the cost priced from them) — the same material summed over every
//   turn it was resident for. What it costs to *keep*.
//
// Only the **input** side is attributed: output and reasoning tokens are what the model
// produced, not material the window carried, so they are no file's or tool's doing and are
// left to the Cost widget's own account of the run.
//
// # What can be attributed
//
// A **view** — a file the agent opened, a value it composed and showed itself, or a page of
// tool documentation it opened — is attributed to its *selector* by the
// [tag](PooledMessage.label) gg records on the pooled message: a path for a file view, the
// agent's own label for a text view, the function's name for a docs view. A stream recorded
// before gg carried that tag falls back to the `read_file` call the view answers (matching its
// `toolCallId` to the arguments of the assistant call that made it), which covers an ordinary
// read but not a pinned, autoloaded specification whose `tool` message was re-framed by a
// compaction. What neither resolves is reported as unattributed rather than dropped, so the
// view list never silently understates the bands it decomposes.
//
// The view bands share one grain deliberately. They answer the same question — *which material
// sat in this window, and what did keeping it cost* — and an operator tuning a configuration
// wants a 12k specification, a 12k agent-composed summary and a documentation page ranked
// against each other, not filed apart. Each row carries its
// [kind](GgViewAttributionRow.kind) so they are still tellable apart where that matters.
//
// Docs views are the one band that has to be *separated* from its neighbours rather than merely
// read: they share the `skill` band with pinned read skills, and only the docs views are views.
// See [viewKindOf].
//
// Tool output is attributed the same way, by the name of the call each result answers.
//
// A run with context visibility off logs no messages at all; the fold then reports
// `known: false` and every list is empty, which is what lets a view say "not recorded"
// rather than "nothing was used".

import type { GgContextSource } from "@test-cabinet/run-record/gg";
import type { ModelPriceLookup } from "./ggCost";
import type { DerivedGgState, PooledMessage } from "./useGgRunState";

/**
 * Which of the three kinds of view a row is: a file the agent opened, a value it composed and
 * showed itself, or a page of the tool documentation it asked to read. Mirrors gg's own closed
 * taxonomy — everything on disk is a file, everything a program can compute is text, and
 * everything the harness can explain about itself is documentation.
 *
 * A docs view is what `view.openDocsView` opens, keyed by the name of the thing it documents. A
 * search view is the results of the agent's last `docs.search` — always one, under one selector,
 * replaced by the next search — and it is its own kind rather than a text view because what
 * *finding* the documentation cost is one of the things the run is being read for.
 */
export type GgViewKind = "file" | "text" | "docs" | "search";

/** One thing the window carried — a band, a view, or a tool — and what it was answerable for. */
export interface GgAttributionRow {
  /** A stable react key, unique within its list. */
  key: string;
  /** How the row reads: the band's name, the view's selector, or the tool's name. */
  label: string;
  /**
   * The material's own estimated size — each distinct message counted once, however many
   * turns it survived. What it cost to bring into the window.
   */
  tokens: number;
  /**
   * The provider-reported input tokens attributed to this material across every turn it was
   * resident for. What it cost to keep, and the figure the cost below is priced from.
   */
  billedTokens: number;
  /**
   * The attributed input cost in USD, or null where the agent's model carries no catalog
   * price (the token figures still hold).
   */
  cost: number | null;
  /** How many turns this material was in the window for. */
  turns: number;
  /** How many distinct messages make it up (a file re-read is two). */
  messages: number;
}

/**
 * A view's row, which additionally says which kind of view it was — the one thing a path, an
 * agent-chosen label and a function's name do not tell apart on their own (`notes` could be any
 * of them).
 */
export interface GgViewAttributionRow extends GgAttributionRow {
  kind: GgViewKind;
}

/** An agent's whole window accounting, read the three ways its material can be grouped. */
export interface GgContextAttribution {
  /**
   * Whether a message log was recorded at all. False for a run with context visibility off,
   * where every list below is empty because nothing was logged — not because nothing was used.
   */
  known: boolean;
  /** How many turns were folded. */
  turns: number;
  /** The provider-reported input tokens across those turns — what the rows partition. */
  billedTokens: number;
  /** The input cost across those turns, or null when the model carries no catalog price. */
  cost: number | null;
  /** One row per context band the window carried, costliest first. */
  bySource: GgAttributionRow[];
  /**
   * One row per view that sat in the window — a file by its path, an agent-composed text view
   * by its label, a documentation view by its function's name — costliest first, the kinds
   * ranked against each other.
   */
  byView: GgViewAttributionRow[];
  /** One row per tool whose output sat in the window, costliest first. */
  byTool: GgAttributionRow[];
  /**
   * The billed tokens of views whose selector could not be resolved — in practice an older
   * stream's re-framed pinned file view, since a text view is keyed by a label gg always
   * records. Reported so the view list is honest about what it does not cover.
   */
  unattributedViewTokens: number;
}

/** How each context band reads in the breakdown. */
const SOURCE_LABELS: Record<GgContextSource, string> = {
  system: "system prompt",
  user_prompt: "user prompt",
  assistant: "assistant turns",
  tool_output: "tool output",
  compiler_error: "compiler errors",
  runtime_error: "runtime errors",
  file_view: "file views",
  text_view: "agent views",
  docs_view: "documentation",
  search_results: "doc search",
  skill: "skills",
  memory: "memories",
  task_list: "task list",
  board: "board",
  history: "history",
};

/** An empty accounting — a run whose stream carried no message log. */
export const EMPTY_ATTRIBUTION: GgContextAttribution = {
  known: false,
  turns: 0,
  billedTokens: 0,
  cost: null,
  bySource: [],
  byView: [],
  byTool: [],
  unattributedViewTokens: 0,
};

// A bucket under construction: the running totals for one band, view, or tool, plus the
// distinct messages it has absorbed (so `tokens` counts a message once however many turns it
// survives) and the turns it appeared on.
interface Bucket {
  label: string;
  billedTokens: number;
  cost: number;
  priced: boolean;
  messages: Set<string>;
  tokens: number;
  turns: number;
  /** The last turn index counted, so a bucket hit twice in one turn still counts one turn. */
  lastTurn: number;
}

// A view's bucket also remembers which kind of view opened it. The kind is fixed at the key,
// never re-decided, because a bucket only ever accumulates messages from one band.
interface ViewBucket extends Bucket {
  kind: GgViewKind;
}

function newBucket(label: string): Bucket {
  return {
    label,
    billedTokens: 0,
    cost: 0,
    priced: false,
    messages: new Set(),
    tokens: 0,
    turns: 0,
    lastTurn: -1,
  };
}

function bucketFor(
  into: Map<string, Bucket>,
  key: string,
  label: string,
): Bucket {
  let bucket = into.get(key);
  if (!bucket) {
    bucket = newBucket(label);
    into.set(key, bucket);
  }
  return bucket;
}

/**
 * The bucket for one view, keyed by **kind and selector** rather than by selector alone: a
 * workspace file named `notes` and a text view an agent labelled `notes` are two different
 * things that must not sum into one row. The key is also what merges an agent's instances
 * together in {@link mergeGgAttributions}, so the same discipline holds across a succession.
 */
function viewBucketFor(
  into: Map<string, ViewBucket>,
  kind: GgViewKind,
  selector: string,
): ViewBucket {
  const key = `${kind}:${selector}`;
  let bucket = into.get(key);
  if (!bucket) {
    bucket = { ...newBucket(selector), kind };
    into.set(key, bucket);
  }
  return bucket;
}

// Credit one message's share of one turn to a bucket.
function credit(
  bucket: Bucket,
  message: PooledMessage,
  turn: number,
  billedTokens: number,
  cost: number | null,
): void {
  if (!bucket.messages.has(message.id)) {
    bucket.messages.add(message.id);
    // Every message this fold ever sees comes off the telemetry pool, which always
    // carries an estimate; the fallback is for the type, not for a case that arises.
    bucket.tokens += message.tokens ?? 0;
  }
  if (bucket.lastTurn !== turn) {
    bucket.lastTurn = turn;
    bucket.turns += 1;
  }
  bucket.billedTokens += billedTokens;
  if (cost != null) {
    bucket.cost += cost;
    bucket.priced = true;
  }
}

// Costliest first — by attributed cost where it is known, and by billed tokens otherwise, so
// an unpriced run still ranks its material rather than listing it in arbitrary order.
function byCostDescending(a: GgAttributionRow, b: GgAttributionRow): number {
  if (a.cost != null && b.cost != null && a.cost !== b.cost)
    return b.cost - a.cost;
  if (b.billedTokens !== a.billedTokens) return b.billedTokens - a.billedTokens;
  return a.label.localeCompare(b.label);
}

function rowOf(key: string, bucket: Bucket): GgAttributionRow {
  return {
    key,
    label: bucket.label,
    tokens: bucket.tokens,
    billedTokens: bucket.billedTokens,
    cost: bucket.priced ? bucket.cost : null,
    turns: bucket.turns,
    messages: bucket.messages.size,
  };
}

function rowsFrom(buckets: Map<string, Bucket>): GgAttributionRow[] {
  return [...buckets].map(([key, b]) => rowOf(key, b)).sort(byCostDescending);
}

function viewRowsFrom(
  buckets: Map<string, ViewBucket>,
): GgViewAttributionRow[] {
  return [...buckets]
    .map(([key, b]) => ({ ...rowOf(key, b), kind: b.kind }))
    .sort(byCostDescending);
}

/**
 * Which kind of view a pooled message is, or null when it is not a view at all.
 *
 * All four view bands map straight across. A `skill` message is never a view: skills and
 * documentation used to share that band and be told apart by whether the message carried a label,
 * and now do not — documentation has a band of its own, and a read skill is authored material an
 * operator pinned rather than something the agent opened and can close.
 *
 * An older stream still carries labelled `skill` messages for the documentation its agent opened,
 * and they are counted in that band rather than promoted into the view list. That is the honest
 * reading of a record written before the split: the band it was recorded under is what the run
 * actually reported.
 */
function viewKindOf(
  source: GgContextSource,
  message: PooledMessage,
): GgViewKind | null {
  if (source === "file_view") return "file";
  if (source === "text_view") return "text";
  if (source === "docs_view" && message.label) return "docs";
  if (source === "search_results") return "search";
  return null;
}

/**
 * The selector a pooled view message shows: the tag gg records on it — a path for a file view,
 * the agent's label for a text view — or, on a stream recorded before gg carried one, the
 * `path` argument of the `read_file` call the view answers, resolved through `callPaths`. Null
 * when neither is available.
 */
function viewSelectorOf(
  message: PooledMessage,
  callPaths: Map<string, string>,
): string | null {
  if (message.label) return message.label;
  if (message.toolCallId) return callPaths.get(message.toolCallId) ?? null;
  return null;
}

/**
 * Index every tool call the message log recorded, so a tool result can be traced back to the
 * call it answers: its tool name (for the per-tool breakdown) and, for a `read_file`, the
 * path it read (the fallback attribution for an untagged file view).
 */
function indexToolCalls(pool: Map<string, PooledMessage>): {
  names: Map<string, string>;
  paths: Map<string, string>;
} {
  const names = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const message of pool.values()) {
    for (const call of message.toolCalls) {
      names.set(call.id, call.name);
      const path = call.args?.["path"];
      if (typeof path === "string" && path.length > 0) paths.set(call.id, path);
    }
  }
  return { names, paths };
}

/**
 * Fold one agent's message log into its context accounting — see the module docs for how a
 * turn's reported input spend is split across the material that made up its request.
 *
 * `modelId` is the model the agent ran on, which decides the rates its input is priced at;
 * `priceOf` resolves those rates from the catalog. Without either, the token figures still
 * hold and every cost reads null.
 */
export function attributeGgContext(
  state: DerivedGgState,
  modelId: string | null,
  priceOf: ModelPriceLookup,
): GgContextAttribution {
  const pool = state.messagePool;
  if (pool.size === 0 || state.prompts.length === 0) return EMPTY_ATTRIBUTION;

  const { names, paths } = indexToolCalls(pool);
  const prices = modelId ? priceOf(modelId) : null;
  const uncachedRate = prices?.uncachedInput ?? null;
  // Cached input falls back to the uncached rate where the catalog lists no distinct one,
  // exactly as the cost breakdown does, rather than costing those tokens at zero.
  const cachedRate = prices?.cachedInput ?? prices?.uncachedInput ?? null;

  const bySource = new Map<string, Bucket>();
  const byView = new Map<string, ViewBucket>();
  const byTool = new Map<string, Bucket>();
  let totalBilled = 0;
  let totalCost = 0;
  let anyPriced = false;
  let unattributedViewTokens = 0;

  state.prompts.forEach((prompt, turn) => {
    // The request's estimated size, summed from the pool rather than read off the prompt's
    // own total, so the shares below sum to exactly 1 even where a pointer resolves to no
    // pooled body (a partial stream) and cannot be credited to anything.
    let estimated = 0;
    for (const ref of prompt.request)
      estimated += pool.get(ref.id)?.tokens ?? 0;
    if (estimated <= 0) return;

    const uncached = prompt.tokens.uncachedInput ?? 0;
    const cached = prompt.tokens.cachedInput ?? 0;
    const billed = uncached + cached;
    const cost =
      uncachedRate != null && cachedRate != null
        ? uncached * uncachedRate + cached * cachedRate
        : null;
    totalBilled += billed;
    if (cost != null) {
      totalCost += cost;
      anyPriced = true;
    }

    for (const ref of prompt.request) {
      const message = pool.get(ref.id);
      if (!message) continue;
      // As in `credit`: this fold only ever reads the telemetry pool, which always
      // carries an estimate. The fallback is for the type.
      const share = (message.tokens ?? 0) / estimated;
      const shareBilled = billed * share;
      const shareCost = cost == null ? null : cost * share;

      credit(
        bucketFor(
          bySource,
          ref.source,
          SOURCE_LABELS[ref.source] ?? ref.source,
        ),
        message,
        turn,
        shareBilled,
        shareCost,
      );

      const kind = viewKindOf(ref.source, message);
      if (kind) {
        const selector = viewSelectorOf(message, paths);
        if (selector == null) unattributedViewTokens += shareBilled;
        else
          credit(
            viewBucketFor(byView, kind, selector),
            message,
            turn,
            shareBilled,
            shareCost,
          );
        // A compiler or runtime error is neither a view nor a tool result — it is a plain user
        // message carrying what a program's failure said, with no call to trace it back to — so
        // it falls through to its own band and nowhere else, which is the whole of its account.
      } else if (ref.source === "tool_output" && message.toolCallId) {
        const name = names.get(message.toolCallId);
        if (name)
          credit(
            bucketFor(byTool, name, name),
            message,
            turn,
            shareBilled,
            shareCost,
          );
      }
    }
  });

  return {
    known: true,
    turns: state.prompts.length,
    billedTokens: totalBilled,
    cost: anyPriced ? totalCost : null,
    bySource: rowsFrom(bySource),
    byView: viewRowsFrom(byView),
    byTool: rowsFrom(byTool),
    unattributedViewTokens,
  };
}

// Merge one list of rows into another, summing every figure. Distinct-message counts and
// resident turns add up across instances too: two instances of one agent that each read the
// same file for ten turns held it for twenty agent-turns between them, which is exactly the
// figure a per-agent (rather than per-instance) read wants.
//
// Generic in the row so a view row carries its `kind` across the merge rather than being
// widened back to a bare row: the key already pins the kind, and the spread below preserves
// every field the caller's row type adds.
function mergeRows<R extends GgAttributionRow>(
  into: Map<string, R>,
  rows: readonly R[],
): void {
  for (const row of rows) {
    const at = into.get(row.key);
    if (!at) {
      into.set(row.key, { ...row });
      continue;
    }
    at.tokens += row.tokens;
    at.billedTokens += row.billedTokens;
    at.turns += row.turns;
    at.messages += row.messages;
    if (row.cost != null) at.cost = (at.cost ?? 0) + row.cost;
  }
}

function mergedRows<R extends GgAttributionRow>(
  parts: readonly GgContextAttribution[],
  pick: (a: GgContextAttribution) => readonly R[],
): R[] {
  const merged = new Map<string, R>();
  for (const part of parts) mergeRows(merged, pick(part));
  return [...merged.values()].sort(byCostDescending);
}

/**
 * Sum the context accountings of every instance of one agent into the agent's own — the
 * per-agent read the Agents tab shows, where a profile's spend is the whole of what its
 * instances spent between them.
 *
 * The result is `known` when *any* instance logged messages: an agent whose second instance
 * ended before its first turn should not blank out the accounting of the first.
 */
export function mergeGgAttributions(
  parts: readonly GgContextAttribution[],
): GgContextAttribution {
  const known = parts.filter((part) => part.known);
  if (known.length === 0) return EMPTY_ATTRIBUTION;
  const priced = known.filter((part) => part.cost != null);
  return {
    known: true,
    turns: known.reduce((sum, part) => sum + part.turns, 0),
    billedTokens: known.reduce((sum, part) => sum + part.billedTokens, 0),
    cost:
      priced.length === 0
        ? null
        : priced.reduce((sum, part) => sum + (part.cost ?? 0), 0),
    bySource: mergedRows(known, (part) => part.bySource),
    byView: mergedRows(known, (part) => part.byView),
    byTool: mergedRows(known, (part) => part.byTool),
    unattributedViewTokens: known.reduce(
      (sum, part) => sum + part.unattributedViewTokens,
      0,
    ),
  };
}
