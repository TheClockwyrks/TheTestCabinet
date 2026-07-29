// What an agent's context window was made of, and what that material cost.
//
// The claim these pin is the one the whole feature rests on: on gg's append-only window a
// message's cost is its size times the number of turns it survived, so the material that
// drives a run's bill is not the biggest message but the one that sat in the window longest.
// A fold that only summed per-message tokens would rank a 500-token file read on the last
// turn above a 400-token specification carried for fifty — and get the tuning advice exactly
// backwards.
//
// So these assert the residency arithmetic, the two attribution paths for a file (the
// selector tag gg records, and the `read_file` fallback for streams recorded before it), the
// honest reporting of what neither path resolves, and that a profile's several instances sum
// into one accounting.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
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

function row(rows: GgAttributionRow[], key: string): GgAttributionRow {
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

    const spec = row(attribution.byFile, "specs/spec.md");
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
    expect(row(attribution.byFile, "src/main.ts").billedTokens).toBeCloseTo(
      200,
      6,
    );
    // The turn's cost is 200 uncached + 600 cached at their own rates, split the same way.
    const turnCost = 200 * 1e-5 + 600 * 1e-6;
    expect(attribution.cost).toBeCloseTo(turnCost, 12);
    expect(row(attribution.byFile, "src/main.ts").cost).toBeCloseTo(
      turnCost * 0.25,
      12,
    );
  });

  it("falls back to the read_file call when a stream carried no selector tag", () => {
    // The pre-label stream: the view carries only the `toolCallId` of the read that produced
    // it, so the path is recovered from the assistant call's arguments.
    const state = reduceGgEvents([
      message("m-call", 20, {
        role: "assistant",
        toolCalls: [
          { id: "c9", name: "read_file", args: { path: "levels/1.json" } },
        ],
      }),
      message("m-view", 480, { toolCallId: "c9" }),
      prompt(
        [
          ["m-call", "assistant"],
          ["m-view", "file_view"],
        ],
        { uncached: 500 },
      ),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.byFile.map((r) => r.key)).toEqual(["levels/1.json"]);
    expect(attribution.unattributedFileTokens).toBe(0);
  });

  it("reports a file view it cannot place rather than dropping it from the band", () => {
    // A pinned specification re-framed by a compaction: it is still a file view, but it has
    // neither a tag (an older stream) nor the tool-call pairing a read would have left.
    const state = reduceGgEvents([
      message("m-orphan", 400, { role: "user" }),
      prompt([["m-orphan", "file_view"]], { uncached: 400 }),
    ]);

    const attribution = attributeGgContext(state, "vendor/m", priceOf);
    expect(attribution.byFile).toEqual([]);
    expect(attribution.unattributedFileTokens).toBeCloseTo(400, 6);
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
    expect(row(attribution.byFile, "a.ts").cost).toBeNull();
    expect(row(attribution.byFile, "a.ts").billedTokens).toBeCloseTo(100, 6);
  });

  it("says nothing was recorded when context visibility was off", () => {
    const attribution = attributeGgContext(
      reduceGgEvents([]),
      "vendor/m",
      priceOf,
    );
    expect(attribution.known).toBe(false);
    expect(attribution.byFile).toEqual([]);
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
    expect(attribution.byFile.map((r) => r.key)).toEqual([
      "small-but-early.md",
      "big-but-late.md",
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
    const shared = row(merged.byFile, "shared.ts");
    // Two distinct reads of the file, resident for three agent-turns between them.
    expect(shared.messages).toBe(2);
    expect(shared.turns).toBe(3);
    expect(shared.tokens).toBe(400);
    expect(shared.billedTokens).toBeCloseTo(700, 6);
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
    expect(merged.byFile).toHaveLength(1);
  });

  it("is empty when no instance logged anything", () => {
    expect(mergeGgAttributions([]).known).toBe(false);
  });
});
