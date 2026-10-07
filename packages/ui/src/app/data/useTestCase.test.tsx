import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryDataProvider, type GalleryDataInput } from "./galleryContext";
import type { TestCaseDetail } from "./testCases";
import { useTestCase } from "./useTestCase";

/**
 * Resolving one test case in full, by slug.
 *
 * A case version directory with runs recorded against it is frozen, so a detail
 * resolved once is that detail for the session. What is checked here is that the
 * hook actually spends that: the several detail surfaces that mount for one case
 * share a single request, and — the part a reader sees — returning to a case
 * already read renders it on the very first frame rather than putting a loading
 * state over text the console is still holding. Each tab of a case is its own
 * route, so returning to one is a remount.
 */

function detail(description: string): TestCaseDetail {
  return { slug: "carom", description } as unknown as TestCaseDetail;
}

/** A host whose `readTestCase` answers with `resolve`, and its provider. */
function hostResolving(resolve: (slug: string) => TestCaseDetail | null) {
  const readTestCase = vi.fn(async (slug: string) => resolve(slug));
  const value = { readTestCase } as unknown as GalleryDataInput;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <GalleryDataProvider value={value}>{children}</GalleryDataProvider>
  );
  return { readTestCase, Wrapper };
}

/** A probe recording every status the hook reported, in render order. */
function probe(slug: string | undefined) {
  const reported: string[] = [];
  function Probe() {
    const { testCase, status } = useTestCase(slug);
    reported.push(status);
    return <p>{testCase?.description ?? status}</p>;
  }
  return { reported, Probe };
}

describe("useTestCase", () => {
  it("resolves the case and reports the wait before it", async () => {
    const { Wrapper } = hostResolving(() => detail("Bank the ball"));
    const { reported, Probe } = probe("carom");

    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect(reported[0]).toBe("loading");
    await waitFor(() => expect(screen.getByText("Bank the ball")).toBeTruthy());
  });

  it("reports a case it has already resolved as ready on the first frame", async () => {
    const { readTestCase, Wrapper } = hostResolving(() =>
      detail("Bank the ball"),
    );
    const first = probe("carom");

    // The tab switch, as the console performs it: the provider stays mounted and
    // the tab body is unmounted and mounted again.
    const view = render(
      <Wrapper>
        <first.Probe />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Bank the ball")).toBeTruthy());
    view.rerender(<Wrapper>{null}</Wrapper>);

    const again = probe("carom");
    view.rerender(
      <Wrapper>
        <again.Probe />
      </Wrapper>,
    );
    expect(again.reported[0]).toBe("ready");
    expect(again.reported).not.toContain("loading");
    expect(screen.getByText("Bank the ball")).toBeTruthy();
    expect(readTestCase).toHaveBeenCalledTimes(1);
  });

  it("shares one request between the surfaces that mount together", async () => {
    const { readTestCase, Wrapper } = hostResolving(() =>
      detail("Bank the ball"),
    );
    const one = probe("carom");
    const two = probe("carom");

    render(
      <Wrapper>
        <one.Probe />
        <two.Probe />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Bank the ball")).toHaveLength(2),
    );
    expect(readTestCase).toHaveBeenCalledTimes(1);
  });

  it("settles ready with no case where the slug has not parsed yet", () => {
    const { readTestCase, Wrapper } = hostResolving(() => detail("unused"));
    const { reported, Probe } = probe(undefined);

    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect(reported).toEqual(["ready"]);
    expect(readTestCase).not.toHaveBeenCalled();
  });

  it("reports a settled miss as ready with no case, and caches it", async () => {
    const { readTestCase, Wrapper } = hostResolving(() => null);
    const { Probe } = probe("nowhere");

    const view = render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    view.rerender(<Wrapper>{null}</Wrapper>);

    // A `null` answer is an answer — "this host has no such case" — and is worth
    // keeping, unlike the `undefined` that means nothing has been asked yet.
    const again = probe("nowhere");
    view.rerender(
      <Wrapper>
        <again.Probe />
      </Wrapper>,
    );
    expect(again.reported[0]).toBe("ready");
    expect(readTestCase).toHaveBeenCalledTimes(1);
  });

  it("resolves afresh against a host that answers differently", async () => {
    const staging = hostResolving(() => detail("staging text"));
    const onStaging = probe("carom");
    render(
      <staging.Wrapper>
        <onStaging.Probe />
      </staging.Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("staging text")).toBeTruthy());

    // Keying the cache on the host's own resolver is what makes the sharing safe:
    // pointing the console at another backend must not serve this one's answers.
    const production = hostResolving(() => detail("production text"));
    const onProduction = probe("carom");
    render(
      <production.Wrapper>
        <onProduction.Probe />
      </production.Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText("production text")).toBeTruthy(),
    );
  });
});
