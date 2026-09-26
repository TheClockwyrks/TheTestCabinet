// What an agent's context window was made of, and what that material cost.
//
// The claim these pin is the one the whole feature rests on: on gg's append-only window a
// message's cost is its size times the number of turns it survived, so the material that
// drives a run's bill is not the biggest message but the one that sat in the window longest.
// A fold that only summed per-message tokens would rank a 500-token file read on the last
// turn above a 400-token specification carried for fifty — and get the tuning advice exactly
// backwards.
//
// So these assert the residency arithmetic, the attribution of a file view to the selector
// tag gg records on it, the honest reporting of a view that carries none, that an
// agent-composed text view is attributed by its label on the same footing, and that a
// profile's several instances sum into one accounting.
//
// They also pin the one band that is not a single thing: `skill` carries both pinned read skills
// and the documentation views `view.openDocsView` opens, and only the latter are views.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@clockwyrks/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelPrices } from "../../../data/models";
import type { ModelPriceLookup } from "./ggCost";
import {
  attributeGgContext,
  mergeGgAttributions,
  type GgAttributionRow,
} from "./ggContextAttribution";
import { reduceGgEvents } from "./useGgRunState";

const TS = "2026-07-29T00:00:00Z";

function gg(kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId: "root",
      ...kind,
    } as GgTelemetryEvent,
  };
}

// One pooled message definition. `label` is the selector tag gg records on a file view.
function message(
  id: string,
  tokens: number,
  extra: {
    role?: string;
    label?: string;
    toolCallId?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  } = {},
): HarnessEvent {
  return gg({
    type: "context_message",
    id,
    role: extra.role ?? "tool",
    content: "…",
    toolCalls: extra.toolCalls ?? [],
    toolCallId: extra.toolCallId,
    images: [],
    tokens,
    label: extra.label,
  } as GgTelemetryKind);
}

// One turn's request as pointers into the pool, with the provider usage it reported.
function prompt(
  refs: Array<[id: string, source: string]>,
  usage: { uncached?: number; cached?: number; output?: number } = {},
): HarnessEvent {
  return gg({
    type: "prompt",
    request: refs.map(([id, source]) => ({ id, source })),
    totalTokens: 0,
    finishReason: "stop",
    tokens: {
      uncachedInput: usage.uncached ?? null,
      cachedInput: usage.cached ?? null,
      output: usage.output ?? null,
      reasoning: null,
    },
    cost: null,
  } as unknown as GgTelemetryKind);
}

const PRICES: Record<string, ModelPrices> = {
  "vendor/m": { uncachedInput: 1e-5, cachedInput: 1e-6, output: 1e-4 },
} as Record<string, ModelPrices>;
const priceOf: ModelPriceLookup = (id) => PRICES[id] ?? null;
const unpriced: ModelPriceLookup = () => null;

// Generic in the row so a view row keeps its `kind` rather than being widened to a bare row.
function row<R extends GgAttributionRow>(rows: readonly R[], key: string): R {
  const found = rows.find((r) => r.key === key);
  expect(found, `no row for ${key}`).toBeDefined();
  return found!;
}

describe("attributeGgContext", () => {
  it("charges material for every turn it stays in the window, not just the turn it entered", () => {
    // A 900-token specification read on turn 1 and never dropped, beside a 100-token tool
    // result that only ever appeared on turn 3. Each turn re-sends everything in the window,
    // so the provider bills the spec three times over and the tool result once.
    const state = reduceGgEvents([
      message("m-sys", 100, { role: "system" }),
      message("m-spec", 900, { label: "specs/spec.md" }),
      prompt(
        [
          ["m-sys", "system"],
          ["m-spec", "file_view"],
        ],
        { uncached: 1000 },
      ),
      prompt(
        [
          ["m-sys", "system"],
          ["m-spec", "file_view"],
        ],
        { uncached: 1000 },
      ),
      message("m-tool", 100, { toolCallId: "c1" }),
      message("m-call", 0, {
        role: "assistant",
        toolCalls: [{ id: "c1", name: "shell", args: {} }],
      }),
      prompt(
        [
          ["m-sys", "system"],
          ["m-spec", "file_view"],
          ["m-tool", "tool_output"],
        ],
        { uncached: 1100 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.known).toBe(true);
    expect(attribution.turns).toBe(3);
    expect(attribution.billedTokens).toBe(3100);

    const spec = row(attribution.byView, "file:specs/spec.md");
    // Its own size is 900 however many turns it survives…
    expect(spec.tokens).toBe(900);
    expect(spec.messages).toBe(1);
    // …but it is billed for all three turns: 900/1000 of turn 1 and 2, 900/1100 of turn 3.
    expect(spec.turns).toBe(3);
    expect(spec.billedTokens).toBeCloseTo(900 + 900 + 900, 6);
    // Priced at the model's uncached-input rate.
    expect(spec.cost).toBeCloseTo(2700 * 1e-5, 10);

    // The tool result is the same size class as nothing else, but was resident for one turn.
    const shell = row(attribution.byTool, "shell");
    expect(shell.turns).toBe(1);
    expect(shell.billedTokens).toBeCloseTo(100, 6);
    // Which is the point: the spec outspends it 27×, though a per-message token count would
    // have called it a mere 9× bigger.
    expect(spec.billedTokens / shell.billedTokens).toBeCloseTo(27, 6);
  });

  it("splits a turn's reported input across its messages, cached tokens at the cached rate", () => {
    const state = reduceGgEvents([
      message("m-a", 300, { role: "system" }),
      message("m-b", 100, { label: "src/main.ts" }),
      prompt(
        [
          ["m-a", "system"],
          ["m-b", "file_view"],
        ],
        // The provider reported 800 tokens against an estimate of 400 — the attribution
        // follows the *reported* figure, apportioned by estimated share (3:1).
        { uncached: 200, cached: 600 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.billedTokens).toBe(800);
    expect(row(attribution.bySource, "system").billedTokens).toBeCloseTo(
      600,
      6,
    );
    expect(
      row(attribution.byView, "file:src/main.ts").billedTokens,
    ).toBeCloseTo(200, 6);
    // The turn's cost is 200 uncached + 600 cached at their own rates, split the same way.
    const turnCost = 200 * 1e-5 + 600 * 1e-6;
    expect(attribution.cost).toBeCloseTo(turnCost, 12);
    expect(row(attribution.byView, "file:src/main.ts").cost).toBeCloseTo(
      turnCost * 0.25,
      12,
    );
  });

  it("reports a file view it cannot place rather than dropping it from the band", () => {
    // A file view carrying no selector tag: it is still a file view, and dropping it would
    // let the view list understate the band it decomposes.
    const state = reduceGgEvents([
      message("m-orphan", 400, { role: "user" }),
      prompt([["m-orphan", "file_view"]], { uncached: 400 }),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.byView).toEqual([]);
    expect(attribution.unattributedViewTokens).toBeCloseTo(400, 6);
    // The band itself still accounts for it, so the breakdown never understates the window.
    expect(row(attribution.bySource, "file_view").billedTokens).toBeCloseTo(
      400,
      6,
    );
  });

  it("keeps every token figure when the model carries no catalog price", () => {
    const state = reduceGgEvents([
      message("m-a", 100, { label: "a.ts" }),
      prompt([["m-a", "file_view"]], { uncached: 100 }),
    ]);
    const attribution = attributeGgContext(state, "vendor/m", unpriced);
    expect(attribution.cost).toBeNull();
    expect(row(attribution.byView, "file:a.ts").cost).toBeNull();
    expect(row(attribution.byView, "file:a.ts").billedTokens).toBeCloseTo(
      100,
      6,
    );
  });

  it("says nothing was recorded when context visibility was off", () => {
    const attribution = attributeGgContext(
      reduceGgEvents([]),
      "vendor/m",
      priceOf,
    );
    expect(attribution.known).toBe(false);
    expect(attribution.byView).toEqual([]);
  });

  it("attributes an agent-composed view to the label the agent gave it", () => {
    // A text view is keyed by a label the agent chose rather than by a path, and it is ranked
    // against files in the same list: an operator tuning a configuration wants to see that a
    // summary the agent kept showing itself outspent the specification it read once.
    const state = reduceGgEvents([
      message("m-spec", 200, { label: "specs/rules.md" }),
      message("m-notes", 600, { role: "user", label: "changed-files" }),
      prompt(
        [
          ["m-spec", "file_view"],
          ["m-notes", "text_view"],
        ],
        { uncached: 800 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    const notes = row(attribution.byView, "text:changed-files");
    expect(notes.label).toBe("changed-files");
    expect(notes.kind).toBe("text");
    expect(notes.billedTokens).toBeCloseTo(600, 6);
    expect(row(attribution.byView, "file:specs/rules.md").kind).toBe("file");
    // The band accounts for it too, under its own name.
    expect(row(attribution.bySource, "text_view").label).toBe("agent views");
    // Both kinds rank in one list, costliest first.
    expect(attribution.byView.map((r) => r.key)).toEqual([
      "text:changed-files",
      "file:specs/rules.md",
    ]);
  });

  it("attributes a documentation view and leaves a read skill out of the view list", () => {
    // The two are separate bands now, and only one of them holds views. A documentation view is
    // keyed by the name it was opened under, can be closed, and is worth ranking against the
    // files and text views an operator is deciding what to trim; a read skill is pinned material
    // the agent cannot close, so filing it into the view list would offer a close that reclaims
    // nothing.
    const state = reduceGgEvents([
      message("m-skill", 500, { role: "user" }),
      message("m-docs", 300, { role: "user", label: "readFile" }),
      prompt(
        [
          ["m-skill", "skill"],
          ["m-docs", "docs_view"],
        ],
        { uncached: 800 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    const docs = row(attribution.byView, "docs:readFile");
    expect(docs.kind).toBe("docs");
    expect(docs.billedTokens).toBeCloseTo(300, 6);
    // The read skill is neither a view nor unattributed material — it is simply not a view.
    expect(attribution.byView.map((r) => r.key)).toEqual(["docs:readFile"]);
    expect(attribution.unattributedViewTokens).toBe(0);
    // Each still accounts to its own band, which is what the graph draws.
    expect(row(attribution.bySource, "skill").billedTokens).toBeCloseTo(500, 6);
    expect(row(attribution.bySource, "docs_view").billedTokens).toBeCloseTo(
      300,
      6,
    );
  });

  it("leaves a program's compiler and runtime errors to their own bands", () => {
    // Both are plain user messages carrying what a responses-as-code failure said: no selector,
    // so no view, and no tool call id, so nothing for the per-tool breakdown to answer to. Their
    // whole account is the band — and the bands must not fall through into the tool list, which
    // would invent a tool nobody called.
    const state = reduceGgEvents([
      message("m-compile", 400, { role: "user" }),
      message("m-runtime", 200, { role: "user" }),
      prompt(
        [
          ["m-compile", "compiler_error"],
          ["m-runtime", "runtime_error"],
        ],
        { uncached: 600 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(row(attribution.bySource, "compiler_error").label).toBe(
      "compiler errors",
    );
    expect(row(attribution.bySource, "runtime_error").billedTokens).toBeCloseTo(
      200,
      6,
    );
    expect(attribution.byView).toEqual([]);
    expect(attribution.byTool).toEqual([]);
    expect(attribution.unattributedViewTokens).toBe(0);
  });

  it("keeps a file and an agent view of the same name apart", () => {
    // A path and an agent-chosen label live in different namespaces, so `notes` can be both.
    // Summing them into one row would invent a thing that was never in the window.
    const state = reduceGgEvents([
      message("m-file", 100, { label: "notes" }),
      message("m-text", 300, { role: "user", label: "notes" }),
      prompt(
        [
          ["m-file", "file_view"],
          ["m-text", "text_view"],
        ],
        { uncached: 400 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.byView).toHaveLength(2);
    expect(row(attribution.byView, "file:notes").billedTokens).toBeCloseTo(
      100,
      6,
    );
    expect(row(attribution.byView, "text:notes").billedTokens).toBeCloseTo(
      300,
      6,
    );
  });

  it("ranks material by what it cost, not by what it weighs", () => {
    const state = reduceGgEvents([
      message("m-big", 800, { label: "big-but-late.md" }),
      message("m-small", 200, { label: "small-but-early.md" }),
      prompt([["m-small", "file_view"]], { uncached: 200 }),
      prompt([["m-small", "file_view"]], { uncached: 200 }),
      prompt([["m-small", "file_view"]], { uncached: 200 }),
      prompt([["m-small", "file_view"]], { uncached: 200 }),
      prompt(
        [
          ["m-small", "file_view"],
          ["m-big", "file_view"],
        ],
        { uncached: 1000 },
      ),
    ]);
    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.byView.map((r) => r.key)).toEqual([
      "file:small-but-early.md",
      "file:big-but-late.md",
    ]);
  });
});

describe("mergeGgAttributions", () => {
  it("sums a profile's instances into one accounting", () => {
    const one = attributeGgContext(
      reduceGgEvents([
        message("m-a", 100, { label: "shared.ts" }),
        prompt([["m-a", "file_view"]], { uncached: 100 }),
      ]),
      "vendor/m",
      priceOf,
    );
    const two = attributeGgContext(
      reduceGgEvents([
        message("m-b", 300, { label: "shared.ts" }),
        prompt([["m-b", "file_view"]], { uncached: 300 }),
        prompt([["m-b", "file_view"]], { uncached: 300 }),
      ]),
      "vendor/m",
      priceOf,
    );

    const merged = mergeGgAttributions([one, two]);
    expect(merged.turns).toBe(3);
    expect(merged.billedTokens).toBe(700);
    const shared = row(merged.byView, "file:shared.ts");
    // Two distinct reads of the file, resident for three agent-turns between them.
    expect(shared.messages).toBe(2);
    expect(shared.turns).toBe(3);
    expect(shared.tokens).toBe(400);
    expect(shared.billedTokens).toBeCloseTo(700, 6);
  });

  it("carries a view's kind across the merge", () => {
    // The merge keys by row key, which already pins the kind — but the row it builds is a
    // fresh object, so the kind has to survive the copy or the list loses the one thing that
    // tells an agent's label apart from a path.
    const each = [1, 2].map((n) =>
      attributeGgContext(
        reduceGgEvents([
          message(`m-${n}`, 100, { role: "user", label: "plan" }),
          prompt([[`m-${n}`, "text_view"]], { uncached: 100 }),
        ]),
        "vendor/m",
        priceOf,
      ),
    );
    const merged = mergeGgAttributions(each);
    const plan = row(merged.byView, "text:plan");
    expect(plan.kind).toBe("text");
    expect(plan.messages).toBe(2);
    expect(plan.billedTokens).toBeCloseTo(200, 6);
  });

  it("stays known when only some instances logged anything", () => {
    const logged = attributeGgContext(
      reduceGgEvents([
        message("m-a", 100, { label: "a.ts" }),
        prompt([["m-a", "file_view"]], { uncached: 100 }),
      ]),
      "vendor/m",
      priceOf,
    );
    const silent = attributeGgContext(reduceGgEvents([]), "vendor/m", priceOf);
    const merged = mergeGgAttributions([logged, silent]);
    expect(merged.known).toBe(true);
    expect(merged.byView).toHaveLength(1);
  });

  it("is empty when no instance logged anything", () => {
    expect(mergeGgAttributions([]).known).toBe(false);
  });
});
