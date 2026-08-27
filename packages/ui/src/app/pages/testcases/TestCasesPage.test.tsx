import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TestType } from "@test-cabinet/run-record";
import type { TestCaseSummary } from "../../data/testCases";
import type { CatalogTab } from "../../routes";
import { routes } from "../../routes";
import { TestCasesPage } from "./TestCasesPage";

// The page's chrome pulls in contexts (backdrop settings, prompt cursor) that
// are irrelevant to the catalog behavior under test; stub them to bare wrappers.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  // The header's chrome is not what these tests are about; its slots are, because a
  // page's own actions live in them. Stub the chrome and pass the slots through, so a
  // control that moves into the header does not silently vanish from the test.
  PromptHeader: ({
    titleActions,
    actions,
  }: {
    titleActions?: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {titleActions}
      {actions}
    </>
  ),
}));

// The preview stage mounts the full replay player for a replay lead — a canvas
// pipeline these DOM tests neither need nor can drive. Stub it to a named
// marker so a test can still assert which recording was staged.
vi.mock("../runs/replay/ReplayPlayer", () => ({
  ReplayPlayer: ({ url, label }: { url: string; label: string }) => (
    <div data-testid="replay-player" data-url={url}>
      {label}
    </div>
  ),
}));

// The catalog is injected through `useTestCases`; mock it so each test seeds an
// exact fixture set rather than standing up a GalleryDataProvider.
const useTestCases = vi.fn();
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => useTestCases(),
}));

// The page reads `canExecute` (console vs. static site) and the case showcase
// media resolver from the gallery context; mock it so each test picks the host
// without a provider.
const useGalleryData = vi.fn();
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => useGalleryData(),
}));

// A catalog entry carrying only the fields the page reads; cast to the full
// summary rather than spell out every unused field.
function testCase(
  name: string,
  testType: TestType,
  extra: Partial<TestCaseSummary> = {},
): TestCaseSummary {
  return {
    slug: name.toLowerCase(),
    name,
    testType,
    difficulty: "hard",
    tags: ["arcade"],
    summary: `${name} summary`,
    versions: ["v1.2.0", "v1.0.0"],
    latestVersion: "v1.2.0",
    ...extra,
  } as TestCaseSummary;
}

/** A one-image catalog showcase for a fixture case, keyed to its latest version. */
function showcaseOf(variant = "base") {
  return {
    version: "v1.2.0",
    variant,
    media: [
      { file: "title.png", name: "Title screen", kind: "image" as const },
    ],
  };
}

// Seed the catalog and the host. `canExecute` defaults to a console (true), where
// the tab bar is always the full set; pass `false` for the static gallery site,
// which shows only tabs the catalog has a case for. The default host resolves
// case showcase media to a predictable URL; pass `resolveMedia: false` for a
// host that serves none.
function ready(
  testCases: TestCaseSummary[],
  {
    canExecute = true,
    resolveMedia = true,
  }: { canExecute?: boolean; resolveMedia?: boolean } = {},
) {
  useTestCases.mockReturnValue({ testCases, status: "ready" });
  useGalleryData.mockReturnValue({
    canExecute,
    caseShowcaseMediaUrl: resolveMedia
      ? (slug: string, version: string, variant: string, file: string) =>
          `https://cdn.example/cases/${slug}/${version}/${variant}/${file}`
      : undefined,
  });
}

// Render the page at a given tab, with the router's location set to that tab's
// route so the tab bar's active link resolves.
function renderPage(tab: CatalogTab = "end-to-end") {
  return render(
    <MemoryRouter initialEntries={[routes.testCasesCatalog(tab)]}>
      <TestCasesPage tab={tab} />
    </MemoryRouter>,
  );
}

/** The index's case names, in listed order (the preview's title is an h3, so
 * the level-2 query sees only the index rows). */
function indexTitles(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

/** The sticky preview pane for the selected case. */
function preview(): HTMLElement {
  return screen.getByRole("region", { name: "Case preview" });
}

describe("TestCasesPage", () => {
  it("on a console, shows only the tab's cases and renders a tab bar over every type", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Skyshard", "asset-generation"),
      testCase("Foray", "adversarial"),
    ]);

    renderPage("end-to-end");

    // The end-to-end tab indexes only that type's case.
    expect(indexTitles()).toEqual(["Sunfront"]);
    expect(screen.queryByText("Skyshard")).not.toBeInTheDocument();
    expect(screen.queryByText("Foray")).not.toBeInTheDocument();

    // The switcher is a nav with one link per tab, each pointing at its route,
    // and the current tab marked active.
    const nav = screen.getByRole("navigation", { name: "Test type" });
    for (const label of [
      "E2E",
      "2D",
      "3D",
      "Blender",
      "Particle",
      "Audio",
      "Adversarial",
      "Performance",
    ]) {
      within(nav).getByRole("link", { name: label });
    }
    expect(
      within(nav).getByRole("link", { name: "Adversarial" }),
    ).toHaveAttribute("href", routes.testCasesCatalog("adversarial"));
    expect(within(nav).getByRole("link", { name: "E2E" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("on the static site, advertises only tabs the published catalog has cases for", () => {
    // The static catalog holds only cases with a published run, so a type with no
    // such case is dropped from the bar (mirroring, for the tabs, the index's
    // published-only listing).
    ready(
      [testCase("Sunfront", "end-to-end"), testCase("Foray", "adversarial")],
      { canExecute: false },
    );

    renderPage("end-to-end");

    const nav = screen.getByRole("navigation", { name: "Test type" });
    // The two covered types stay.
    within(nav).getByRole("link", { name: "E2E" });
    within(nav).getByRole("link", { name: "Adversarial" });
    // Every uncovered type is hidden.
    for (const label of [
      "Full-stack",
      "2D",
      "3D",
      "Blender",
      "Particle",
      "Audio",
      "Performance",
    ]) {
      expect(
        within(nav).queryByRole("link", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("scopes the index to the rendered tab's type", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Foray", "adversarial"),
    ]);

    renderPage("adversarial");

    expect(indexTitles()).toEqual(["Foray"]);
    expect(screen.queryByText("Sunfront")).not.toBeInTheDocument();
  });

  it("partitions asset-generation into 2D, 3D, Blender, Particle, and Audio tabs by asset kind", () => {
    const cases = [
      // 2D family: the sprite kinds and the paint kinds.
      testCase("Skyshard", "asset-generation", { assetKind: "sprite" }),
      testCase("Flarefish", "asset-generation", { assetKind: "sprite-sheet" }),
      testCase("Thunderhead", "asset-generation", { assetKind: "ui" }),
      testCase("Basalt", "asset-generation", { assetKind: "material" }),
      // 3D family: the voxel/mesh kinds and the skinned kinds.
      testCase("Aegis", "asset-generation", { assetKind: "voxel-animation" }),
      testCase("Lanternjaw", "asset-generation", { assetKind: "mc-model" }),
      testCase("Trooper", "asset-generation", { assetKind: "sn-skinned" }),
      // Blender family: the glTF-character kind (its own tab, not 2D or 3D).
      testCase("Rifleman", "asset-generation", {
        assetKind: "blender-character",
      }),
      // Particle and audio families.
      testCase("Spectra", "asset-generation", { assetKind: "particle-3d" }),
      testCase("Broadside", "asset-generation", { assetKind: "sfx-sample" }),
      testCase("Theme", "asset-generation", { assetKind: "music" }),
    ];

    // The 2D tab keeps the sprite and paint kinds (not the Blender character).
    ready(cases);
    const twoD = renderPage("2d");
    expect(indexTitles()).toEqual([
      "Basalt",
      "Flarefish",
      "Skyshard",
      "Thunderhead",
    ]);
    twoD.unmount();

    // The 3D tab keeps the voxel/mesh and skinned kinds (not the Blender character).
    ready(cases);
    const threeD = renderPage("3d");
    expect(indexTitles()).toEqual(["Aegis", "Lanternjaw", "Trooper"]);
    threeD.unmount();

    // The Blender tab keeps only the glTF-character kind.
    ready(cases);
    const blender = renderPage("blender");
    expect(indexTitles()).toEqual(["Rifleman"]);
    blender.unmount();

    // Particle and audio each get their own tab.
    ready(cases);
    const particle = renderPage("particle");
    expect(indexTitles()).toEqual(["Spectra"]);
    particle.unmount();

    ready(cases);
    renderPage("audio");
    expect(indexTitles()).toEqual(["Broadside", "Theme"]);
  });

  it("treats an asset case with no asset kind as a 2D sprite", () => {
    ready([testCase("Skyshard", "asset-generation")]);

    renderPage("2d");

    expect(indexTitles()).toEqual(["Skyshard"]);
  });

  it("lists cases in the index alphabetically", () => {
    ready([
      testCase("Zephyr", "end-to-end"),
      testCase("Aurora", "end-to-end"),
      testCase("Meltdown", "end-to-end"),
    ]);

    renderPage("end-to-end");

    expect(indexTitles()).toEqual(["Aurora", "Meltdown", "Zephyr"]);
  });

  it("shows each case's latest version on its index row", () => {
    ready([
      testCase("Sunfront", "end-to-end"),
      testCase("Wireworm", "end-to-end", {
        versions: ["v2.1.0", "v1.0.0"],
        latestVersion: "v2.1.0",
      }),
    ]);

    renderPage("end-to-end");

    // Each row carries its own case's newest version (the selected case's chip
    // appears in the preview too, so match within the rows).
    within(screen.getByRole("option", { name: /Sunfront/ })).getByText(
      "v1.2.0",
    );
    within(screen.getByRole("option", { name: /Wireworm/ })).getByText(
      "v2.1.0",
    );
  });

  it("selects the first shown case by default and stages it in the preview", () => {
    ready([testCase("Zephyr", "end-to-end"), testCase("Aurora", "end-to-end")]);

    renderPage("end-to-end");

    expect(screen.getByRole("option", { name: /Aurora/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /Zephyr/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    within(preview()).getByRole("heading", { level: 3, name: "Aurora" });
    within(preview()).getByText("Aurora summary");
  });

  it("clicking an index row moves the preview to that case", () => {
    ready([
      testCase("Aurora", "end-to-end"),
      testCase("Zephyr", "end-to-end", {
        difficulty: "easy",
        tags: ["puzzle"],
      }),
    ]);

    renderPage("end-to-end");
    fireEvent.click(screen.getByRole("option", { name: /Zephyr/ }));

    expect(screen.getByRole("option", { name: /Zephyr/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const pane = preview();
    within(pane).getByRole("heading", { level: 3, name: "Zephyr" });
    within(pane).getByText("Zephyr summary");
    // The preview carries the case's difficulty badge and tag pills.
    within(pane).getByText("easy");
    within(pane).getByText("puzzle");
  });

  it("falls back to the first shown case when the search filters the selection out", () => {
    ready([testCase("Aurora", "end-to-end"), testCase("Zephyr", "end-to-end")]);

    renderPage("end-to-end");
    fireEvent.click(screen.getByRole("option", { name: /Zephyr/ }));
    within(preview()).getByRole("heading", { level: 3, name: "Zephyr" });

    // Narrowing to Aurora drops the clicked case from the index; the preview
    // follows the first (only) shown case rather than going blank.
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search test cases" }),
      { target: { value: "aurora" } },
    );
    expect(indexTitles()).toEqual(["Aurora"]);
    within(preview()).getByRole("heading", { level: 3, name: "Aurora" });
  });

  it("marks only cases with a showcase in the index", () => {
    ready([
      testCase("Carom", "end-to-end", { showcase: showcaseOf() }),
      testCase("Sunfront", "end-to-end"),
    ]);

    renderPage("end-to-end");

    const markers = screen.getAllByRole("img", { name: "Has a showcase" });
    expect(markers).toHaveLength(1);
    within(screen.getByRole("option", { name: /Carom/ })).getByRole("img", {
      name: "Has a showcase",
    });
  });

  it("stages the selected case's first showcase media through the host's resolver", () => {
    ready([testCase("Carom", "end-to-end", { showcase: showcaseOf() })]);

    renderPage("end-to-end");

    const image = within(preview()).getByRole("img", {
      name: "Title screen",
    });
    expect(image).toHaveAttribute(
      "src",
      "https://cdn.example/cases/carom/v1.2.0/base/title.png",
    );
  });

  it("stages a replay lead in the player's showcase presentation", () => {
    ready([
      testCase("Carom", "end-to-end", {
        showcase: {
          version: "v1.2.0",
          variant: "base",
          media: [
            { file: "rally.json.gz", name: "A rally", kind: "replay" as const },
          ],
        },
      }),
    ]);

    renderPage("end-to-end");

    const player = within(preview()).getByTestId("replay-player");
    expect(player).toHaveTextContent("A rally");
    expect(player).toHaveAttribute(
      "data-url",
      "https://cdn.example/cases/carom/v1.2.0/base/rally.json.gz",
    );
  });

  it("filmstrips the whole carousel and stages the clicked entry", () => {
    // Six entries: every one gets a thumb (no cap), in the carousel's order,
    // with the staged entry marked selected.
    ready([
      testCase("Carom", "end-to-end", {
        showcase: {
          version: "v1.2.0",
          variant: "base",
          media: [
            { file: "title.png", name: "Title screen", kind: "image" as const },
            { file: "play-1.png", name: "Play 1", kind: "image" as const },
            { file: "play-2.png", name: "Play 2", kind: "image" as const },
            { file: "play-3.png", name: "Play 3", kind: "image" as const },
            { file: "play-4.png", name: "Play 4", kind: "image" as const },
            { file: "play-5.png", name: "Play 5", kind: "image" as const },
          ],
        },
      }),
    ]);

    renderPage("end-to-end");

    const strip = within(preview()).getByRole("tablist", {
      name: "Showcase media",
    });
    const thumbs = within(strip).getAllByRole("tab");
    expect(thumbs.map((thumb) => thumb.getAttribute("aria-label"))).toEqual([
      "Show Title screen",
      "Show Play 1",
      "Show Play 2",
      "Show Play 3",
      "Show Play 4",
      "Show Play 5",
    ]);
    expect(thumbs[0]).toHaveAttribute("aria-selected", "true");

    // Clicking a thumb stages that entry and moves the selection to it.
    fireEvent.click(within(strip).getByRole("tab", { name: "Show Play 2" }));
    expect(
      within(strip).getByRole("tab", { name: "Show Play 2" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(preview()).getByRole("img", { name: "Play 2" }),
    ).toHaveAttribute(
      "src",
      "https://cdn.example/cases/carom/v1.2.0/base/play-2.png",
    );
  });

  it("resets the filmstrip selection when the selected case changes", () => {
    const carousel = (slug: string) => ({
      version: "v1.2.0",
      variant: "base",
      media: [
        { file: "one.png", name: `${slug} one`, kind: "image" as const },
        { file: "two.png", name: `${slug} two`, kind: "image" as const },
      ],
    });
    ready([
      testCase("Aurora", "end-to-end", { showcase: carousel("Aurora") }),
      testCase("Zephyr", "end-to-end", { showcase: carousel("Zephyr") }),
    ]);

    renderPage("end-to-end");

    // Stage Aurora's second entry, then move to Zephyr: its stage starts back
    // at the first entry rather than inheriting Aurora's selection.
    fireEvent.click(screen.getByRole("tab", { name: "Show Aurora two" }));
    within(preview()).getByRole("img", { name: "Aurora two" });
    fireEvent.click(screen.getByRole("option", { name: /Zephyr/ }));
    within(preview()).getByRole("img", { name: "Zephyr one" });
    expect(
      screen.getByRole("tab", { name: "Show Zephyr one" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("shows an icon-only play glyph for a thumb with no still", () => {
    ready([
      testCase("Carom", "end-to-end", {
        showcase: {
          version: "v1.2.0",
          variant: "base",
          media: [
            { file: "title.png", name: "Title screen", kind: "image" as const },
            { file: "rally.json.gz", name: "A rally", kind: "replay" as const },
          ],
        },
      }),
    ]);

    renderPage("end-to-end");

    // A replay has no cheap still, so its thumb is the bare play glyph — the
    // kind never rides along as text.
    const thumb = screen.getByRole("tab", { name: "Show A rally" });
    expect(thumb).toHaveTextContent("▶");
    expect(thumb).not.toHaveTextContent("replay");
  });

  it("splits the panes with a keyboard-adjustable divider", () => {
    ready([testCase("Sunfront", "end-to-end")]);

    renderPage("end-to-end");

    // The divider between the index and the preview, at the 40/60 default…
    const divider = screen.getByRole("separator", {
      name: "Resize the index and preview panes",
    });
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("aria-valuenow", "40");

    // …nudged by the arrow keys…
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "38");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "42");

    // …and clamped so neither pane can be crushed.
    for (let i = 0; i < 30; i++) {
      fireEvent.keyDown(divider, { key: "ArrowLeft" });
    }
    expect(divider).toHaveAttribute("aria-valuenow", "25");
  });

  it("shows the placeholder stage for a case without a showcase", () => {
    ready([testCase("Sunfront", "end-to-end")]);

    renderPage("end-to-end");

    // No media is staged — the cabinet mark holds the stage instead — and the
    // pane still shows the case's identity around the placeholder.
    const pane = preview();
    within(pane).getByRole("img", { name: "Arcade cabinet" });
    expect(
      within(pane).queryByRole("img", { name: "Title screen" }),
    ).not.toBeInTheDocument();
    expect(within(pane).queryByTestId("replay-player")).not.toBeInTheDocument();
    within(pane).getByRole("heading", { level: 3, name: "Sunfront" });
  });

  it("shows the placeholder stage when the host cannot serve showcase media", () => {
    ready([testCase("Carom", "end-to-end", { showcase: showcaseOf() })], {
      resolveMedia: false,
    });

    renderPage("end-to-end");

    // The marker still advertises the showcase, but with no resolver the stage
    // degrades to the placeholder rather than a broken viewer.
    screen.getByRole("img", { name: "Has a showcase" });
    within(preview()).getByRole("img", { name: "Arcade cabinet" });
    expect(
      within(preview()).queryByRole("img", { name: "Title screen" }),
    ).not.toBeInTheDocument();
  });

  it("links the preview into the selected case's detail page", () => {
    ready([testCase("Sunfront", "end-to-end")]);

    renderPage("end-to-end");

    expect(
      within(preview()).getByRole("link", { name: "Open case" }),
    ).toHaveAttribute("href", routes.testCaseDetail("sunfront"));
  });

  it("searches over tags and difficulty as well as the title", () => {
    ready([
      testCase("Sunfront", "end-to-end", { difficulty: "hard", tags: ["rts"] }),
      testCase("Carom", "end-to-end", {
        difficulty: "easy",
        tags: ["arcade"],
      }),
    ]);

    renderPage("end-to-end");
    const search = screen.getByRole("searchbox", { name: "Search test cases" });

    // A tag term keeps only the case that carries it.
    fireEvent.change(search, { target: { value: "arcade" } });
    expect(indexTitles()).toEqual(["Carom"]);

    // A difficulty term filters the same way.
    fireEvent.change(search, { target: { value: "hard" } });
    expect(indexTitles()).toEqual(["Sunfront"]);
  });

  it("shows an empty notice (and no preview) when the tab has no cases", () => {
    ready([testCase("Skyshard", "asset-generation", { assetKind: "sprite" })]);

    renderPage("end-to-end");

    // The end-to-end tab has none of this asset-only catalog.
    expect(screen.getByText("No test cases match.")).toBeInTheDocument();
    expect(indexTitles()).toEqual([]);
    expect(
      screen.queryByRole("region", { name: "Case preview" }),
    ).not.toBeInTheDocument();
  });
});
