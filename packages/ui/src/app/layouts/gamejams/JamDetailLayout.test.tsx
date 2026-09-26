import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseVariantRef } from "../../data/galleryContext";
import type { TestCaseDetail, VariantSummary } from "../../data/testCases";
import { JamDetailLayout } from "./JamDetailLayout";

// The layout's chrome reads app-wide contexts (the backdrop settings the page
// shell owns) that say nothing about the header these tests exercise, so the
// shell is stubbed to a plain wrapper.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// The host the layout resolves the anchored coordinate through. The resolver
// lives in a hoisted cell (a `vi.mock` factory is hoisted above module scope)
// and is re-seeded per test: the resolution cache keys on the resolver's
// identity, so a fresh function per test keeps resolved coordinates from
// leaking between tests.
const host = vi.hoisted(() => ({
  fetchCaseVariant: (() => Promise.resolve(null)) as (
    ref: CaseVariantRef,
  ) => Promise<VariantSummary | null>,
}));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({
    canExecute: false,
    fetchCaseVariant: host.fetchCaseVariant,
  }),
}));
// The jam the layout resolves from the slug. Held in a hoisted cell so a test
// can swap it before rendering.
const fixture = vi.hoisted(() => ({
  jam: null as unknown,
  status: "ready" as string,
}));
vi.mock("../../data/useTestCase", () => ({
  useTestCase: () => ({ testCase: fixture.jam, status: fixture.status }),
}));

function jam(): TestCaseDetail {
  return {
    slug: "neon-drift",
    name: "Neon Drift",
    testType: "game-jam",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    tags: ["arcade"],
    description: null,
    changelog: [],
    errata: [],
    variants: [{ slug: "base", name: "Base" }],
    // The frame the coordinate is derived from: a jam is single-variant and
    // engineless, so the default coordinate is its only rendering.
    variantsByVersion: { "v1.0.0": [{ slug: "base", name: "Base" }] },
    enginesByVersion: { "v1.0.0": ["none"] },
    domains: [],
  } as unknown as TestCaseDetail;
}

async function renderLayout() {
  fixture.jam = jam();
  fixture.status = "ready";
  render(
    <MemoryRouter initialEntries={["/game-jams/neon-drift"]}>
      <Routes>
        <Route
          path="/game-jams/:slug"
          element={
            <JamDetailLayout tab="overview">
              {() => <p>body</p>}
            </JamDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  // Let the coordinate resolution settle so the body (and the tab strip) are
  // up before a test asserts anything.
  await screen.findByText("body");
}

describe("JamDetailLayout", () => {
  beforeEach(() => {
    // A new identity per test — see the cell's comment.
    host.fetchCaseVariant = vi.fn(
      async (ref: CaseVariantRef) =>
        ({
          slug: ref.variant,
          name: "Base",
          description: null,
          prompt: "Build something for the theme.",
          seededInputs: [],
          packages: [],
          referenceScreenshots: [],
          reviewItems: [],
          domains: [],
          validatorRated: false,
          referenceBuilds: {},
          referenceSheet: null,
        }) as VariantSummary,
    );
  });

  it("titles the header with the jam", async () => {
    await renderLayout();
    expect(screen.getByRole("heading", { name: "Neon Drift" })).toBeTruthy();
  });

  // The jam pages shipped without the back control every other detail page
  // carries, stranding visitors on a jam with no way back to the list.
  it("offers a back control returning to the Game Jams list", async () => {
    await renderLayout();
    const back = screen.getByRole("link", { name: "All game jams" });
    expect(back.getAttribute("href")).toBe("/other/game-jams");
  });

  // The three outcomes of the fetch, which this layout used to collapse into
  // two: a fetch in flight and a fetch that failed both read as "no game jam
  // found", which is the page answering a question it has no answer to.
  it.each([
    ["loading", "Loading game jam…"],
    ["error", "Could not load the game jam"],
  ])("reports a %s fetch as itself, never as a missing jam", (status, text) => {
    fixture.jam = null;
    fixture.status = status;
    render(
      <MemoryRouter initialEntries={["/game-jams/neon-drift"]}>
        <Routes>
          <Route
            path="/game-jams/:slug"
            element={
              <JamDetailLayout tab="overview">
                {() => <p>body</p>}
              </JamDetailLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(new RegExp(text))).toBeTruthy();
    expect(screen.queryByText(/No game jam found/)).toBeNull();
  });
});
