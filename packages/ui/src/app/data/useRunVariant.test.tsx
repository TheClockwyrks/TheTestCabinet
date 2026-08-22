import type { ReactNode } from "react";
import type { RunSubject } from "@test-cabinet/run-record";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  GalleryDataProvider,
  type CaseVariantRef,
  type GalleryDataInput,
} from "./galleryContext";
import type { VariantSummary } from "./testCases";
import { useRunVariant } from "./useRunVariant";

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
