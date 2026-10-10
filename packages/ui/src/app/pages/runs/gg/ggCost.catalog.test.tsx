// Which catalog price the gg run views split a run's cost by.
//
// A model has one price, its list price: the figure a run's comparable cost is
// computed from. The per-class split shown on a gg run is priced from that same
// figure, so the split and the total it divides agree on their basis. These pin
// the hooks that bind the split to the loaded catalog.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { ModelSummary } from "../../../data/models";
import { useGgCostBreakdown, useGgSpend, type PricedSlot } from "./ggCost";
import type { SlotUsage } from "./useGgRunState";

const MODEL_ID = "anthropic/claude-x";

function model(listPrice: ModelSummary["listPrice"]): ModelSummary {
  return {
    slug: "claude-x",
    name: "Claude X",
    provider: "Anthropic",
    modelIds: [MODEL_ID],
    aliases: [],
    listPrice,
  } as unknown as ModelSummary;
}

function wrapper(models: ModelSummary[]) {
  const value = {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models,
    modelsStatus: "ready",
    canExecute: false,
  } as unknown as GalleryDataInput;
  return ({ children }: { children: ReactNode }) => (
    <GalleryDataProvider value={value}>{children}</GalleryDataProvider>
  );
}

// A million tokens of each class, so each class's cost is its per-Mtok rate.
const TOKENS = {
  uncachedInput: 1_000_000,
  cachedInput: 1_000_000,
  output: 1_000_000,
  reasoning: 1_000_000,
};
const SLOTS: PricedSlot[] = [{ tokens: TOKENS, modelId: MODEL_ID }];

describe("the gg cost split's catalog price", () => {
  it("prices each token class at the model's list price", () => {
    const { result } = renderHook(() => useGgCostBreakdown(SLOTS), {
      wrapper: wrapper([
        model({ uncachedInput: 3e-6, cachedInput: 3e-7, output: 15e-6 }),
      ]),
    });
    expect(result.current).not.toBeNull();
    expect(result.current!.input).toBeCloseTo(3, 9);
    expect(result.current!.cachedInput).toBeCloseTo(0.3, 9);
    expect(result.current!.output).toBeCloseTo(15, 9);
    // Reasoning takes the output rate.
    expect(result.current!.reasoning).toBeCloseTo(15, 9);
    expect(result.current!.total).toBeCloseTo(33.3, 9);
  });

  it("has no split for a model without a list price", () => {
    const { result } = renderHook(() => useGgCostBreakdown(SLOTS), {
      wrapper: wrapper([model(null)]),
    });
    expect(result.current).toBeNull();
  });

  it("prices a spend row the run reported no cost for at the list price", () => {
    const usage = [
      {
        profileId: "main",
        modelId: MODEL_ID,
        tokens: TOKENS,
        cost: null,
      },
    ] as unknown as SlotUsage[];
    const { result } = renderHook(() => useGgSpend(usage, null), {
      wrapper: wrapper([
        model({ uncachedInput: 3e-6, cachedInput: 3e-7, output: 15e-6 }),
      ]),
    });
    const row = result.current.perModel[0]!;
    expect(row.cost).toBeCloseTo(33.3, 9);
    expect(row.derived).toBe(true);
  });
});
