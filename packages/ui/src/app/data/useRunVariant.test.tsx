import type { ReactNode } from "react";
import type { RunSubject } from "@clockwyrks/run-record";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  GalleryDataProvider,
  type CaseVariantRef,
  type GalleryDataInput,
} from "./galleryContext";
import type { VariantSummary } from "./testCases";
import { useReviewModel, useRunVariant } from "./useRunVariant";

// A variant carrying only what these tests read back: the prompt, which is the
// text the resolution has to get right.
function variant(prompt: string): VariantSummary {
  return { slug: "base", prompt } as unknown as VariantSummary;
}

// A run's subject. The defaults are a run of an OLDER version on an engine, which
// is the pair the tab used to get wrong in both halves.
function subject(over: Partial<RunSubject> = {}): RunSubject {
  return {
    testCaseSlug: "carom",
    testCaseVersion: "v2.1.0",
    variant: "base",
    engineSlug: "simple-2d",
    ...over,
  } as unknown as RunSubject;
}

// A host that answers with the reference it was handed, so a test can assert on
// exactly what was asked for.
function hostResolving(
  resolve: (ref: CaseVariantRef) => VariantSummary | null,
) {
  const readCaseVariant = vi.fn(async (ref: CaseVariantRef) => resolve(ref));
  const value = { readCaseVariant } as unknown as GalleryDataInput;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GalleryDataProvider value={value}>{children}</GalleryDataProvider>
  );
  return { readCaseVariant, wrapper };
}

describe("useRunVariant", () => {
  // The defect this replaces: the tab resolved a run's inputs out of the case's
  // LATEST version, so a run of carom v2.1.0 was shown v3.0.0's prompt — a
  // different deliverable entirely.
  it("resolves the run's own case version rather than the case's latest", async () => {
    const { readCaseVariant, wrapper } = hostResolving((ref) =>
      variant(`prompt for ${ref.version}`),
    );

    const { result } = renderHook(() => useRunVariant(subject()), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(readCaseVariant.mock.calls[0]![0].version).toBe("v2.1.0");
    expect(result.current.variant?.prompt).toBe("prompt for v2.1.0");
  });

  // The other half: a case's prompt and specs branch on the selected engine, so a
  // run on `simple-2d` was handed different text than the engineless rendering.
  it("resolves the run's own engine", async () => {
    const { readCaseVariant, wrapper } = hostResolving((ref) =>
      variant(`built on ${ref.engine}`),
    );

    const { result } = renderHook(() => useRunVariant(subject()), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(readCaseVariant.mock.calls[0]![0].engine).toBe("simple-2d");
    expect(result.current.variant?.prompt).toBe("built on simple-2d");
  });

  // A run that selected no engine records `none`, and that is passed through as
  // itself rather than being dropped: the engineless rendering is a rendering, not
  // the absence of one.
  it("passes an engineless run's recorded engine through", async () => {
    const { readCaseVariant, wrapper } = hostResolving((ref) =>
      variant(`built on ${ref.engine}`),
    );

    const { result } = renderHook(
      () => useRunVariant(subject({ engineSlug: "none" })),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(readCaseVariant.mock.calls[0]![0].engine).toBe("none");
  });

  // A host that holds no such version/variant/engine reports it as unavailable
  // once settled, rather than falling back to a rendering the run never saw.
  it("reports a settled miss as unavailable rather than substituting one", async () => {
    const { wrapper } = hostResolving(() => null);

    const { result } = renderHook(() => useRunVariant(subject()), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.variant).toBeUndefined();
  });

  // The wait has to be distinguishable from the miss, or an in-flight fetch reads
  // as a dead end.
  it("reports the fetch in flight as loading", () => {
    const readCaseVariant = vi.fn(() => new Promise<null>(() => {}));
    const value = { readCaseVariant } as unknown as GalleryDataInput;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GalleryDataProvider value={value}>{children}</GalleryDataProvider>
    );

    const { result } = renderHook(() => useRunVariant(subject()), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(result.current.variant).toBeUndefined();
  });
});

// A variant carrying the scoring model these tests read back.
function scoring(
  items: readonly string[],
  domains: readonly string[],
): VariantSummary {
  return {
    slug: "base",
    reviewItems: items.map((id) => ({ id })),
    domains: domains.map((id) => ({ id })),
  } as unknown as VariantSummary;
}

describe("useReviewModel", () => {
  // The defect this replaces was not cosmetic: the model came from the case's
  // LATEST version, so a run of carom v2.1.0 was scored against v3.0.0's
  // checklist — deciding its verdict against points it was never graded on. The
  // two versions genuinely differ: v3 added `delta-time-independent` and `trail`
  // and dropped `game-over` and `rally`.
  it("scores a run against its own version's checklist, not the latest", async () => {
    const byVersion: Record<string, VariantSummary> = {
      "v2.1.0": scoring(["gameplay", "rally"], ["single-player"]),
      "v3.0.0": scoring(["delta-time-independent", "trail"], ["versus"]),
    };
    const { readCaseVariant, wrapper } = hostResolving(
      (ref) => byVersion[ref.version] ?? null,
    );

    const { result } = renderHook(() => useReviewModel(subject()), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(readCaseVariant.mock.calls[0]![0].version).toBe("v2.1.0");
    expect(result.current.items.map((i) => i.id)).toEqual([
      "gameplay",
      "rally",
    ]);
    expect(result.current.domains.map((d) => d.id)).toEqual(["single-player"]);
  });

  // A point whose validator names a set of engines is decided only under those, so
  // a run built on any other engine does not carry it: the validators never drove
  // it, the backend's checklist (`review_items_for_engine`) drops it, and a
  // verdict recorded against it here would be refused as an override of a point
  // the run's checklist does not carry.
  it("drops a point whose validator does not cover the run's engine", async () => {
    const items = [
      { id: "gameplay" },
      { id: "overlay", validation: { engines: ["none"] } },
      { id: "menus", validation: { engines: ["none", "simple-2d"] } },
    ];
    const { wrapper } = hostResolving(
      () =>
        ({
          slug: "base",
          reviewItems: items,
          domains: [],
        }) as unknown as VariantSummary,
    );

    const { result } = renderHook(
      () => useReviewModel(subject({ engineSlug: "simple-2d" })),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.map((i) => i.id)).toEqual([
      "gameplay",
      "menus",
    ]);
  });

  // The same run on the engine the point IS scoped to carries it, so the scoping
  // narrows a checklist rather than retiring a point.
  it("keeps the point on the engine its validator names", async () => {
    const items = [
      { id: "gameplay" },
      { id: "overlay", validation: { engines: ["none"] } },
    ];
    const { wrapper } = hostResolving(
      () =>
        ({
          slug: "base",
          reviewItems: items,
          domains: [],
        }) as unknown as VariantSummary,
    );

    const { result } = renderHook(
      () => useReviewModel(subject({ engineSlug: "none" })),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.map((i) => i.id)).toEqual([
      "gameplay",
      "overlay",
    ]);
  });

  // A model from the wrong version is worse than no model, so an unresolvable
  // version reports empty and lets `status` say why, rather than substituting
  // another version's domains the way the old fall back to the case's did.
  it("reports no model rather than substituting one when the version is not held", async () => {
    const { wrapper } = hostResolving(() => null);

    const { result } = renderHook(() => useReviewModel(subject()), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toEqual([]);
    expect(result.current.domains).toEqual([]);
  });
});
