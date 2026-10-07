import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VariantSummary } from "../data/testCases";
import { VariantInputsView } from "./VariantViews";

// A variant carrying one prose spec, one script starter, and one shipped package,
// so the Inputs view exercises every body shape the two roles + packages produce.
function variant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    description: null,
    prompt: "Build it.",
    seededInputs: [
      { path: "specs/brief.md", kind: "text", role: "spec", text: "# Brief" },
      {
        path: "build.py",
        kind: "text",
        role: "script",
        text: "import bpy\n",
      },
    ],
    packages: [
      {
        name: "@clockwyrks/particle-runtime",
        description: "Plays a produced particle system live on a canvas.",
      },
    ],
    referenceScreenshots: [],
    reviewItems: [],
    domains: [],
    validatorRated: false,
    referenceBuilds: {},
    referenceSheet: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VariantInputsView", () => {
  it("stages the prompt first, with every input listed under its group", () => {
    render(<VariantInputsView variant={variant()} />);

    // The prompt starts selected: its body is on the stage under its group
    // heading, and its rail row marked current.
    expect(screen.getByText("Build it.")).toBeInTheDocument();
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "prompt" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Every other input is a rail row under its group heading.
    expect(screen.getByText("Specs")).toBeInTheDocument();
    expect(screen.getByText("Packages")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "specs/brief.md" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "build.py" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "@clockwyrks/particle-runtime" }),
    ).toBeInTheDocument();

    // Groups the variant has nothing for are omitted from the rail.
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Reference")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous entries")).not.toBeInTheDocument();
  });

  it("renders prose for Markdown, inline highlighted source otherwise", () => {
    const { container } = render(<VariantInputsView variant={variant()} />);

    // A Markdown spec reads as prose (its heading is a real heading)…
    fireEvent.click(screen.getByRole("button", { name: "specs/brief.md" }));
    expect(screen.getByRole("heading", { name: "Brief" })).toBeInTheDocument();

    // …while a script starter reads as inline source: the text verbatim, with
    // syntax token markup for the recognized extension.
    fireEvent.click(screen.getByRole("button", { name: "build.py" }));
    expect(container.querySelector("code")?.textContent).toBe("import bpy\n");
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe(
      "import",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "@clockwyrks/particle-runtime" }),
    );
    expect(
      screen.getByText("Plays a produced particle system live on a canvas."),
    ).toBeInTheDocument();
  });

  it("fetches a workspace file lazily, on selection only", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "export const main = 1;\n",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <VariantInputsView
        variant={variant({
          workspace: [
            { path: "src/main.ts", url: "https://cdn.example/main.ts" },
          ],
        })}
      />,
    );

    // Listed under its group, but not fetched while the prompt is staged.
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "src/main.ts" }));
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/main.ts");
    // The wait reads as a loading state, then the file body lands as code.
    expect(screen.getByText("Loading file…")).toBeInTheDocument();
    // The file body lands as inline source (highlighted, so the text is split
    // across token spans — assert on the whole code element).
    await waitFor(() =>
      expect(container.querySelector("code")?.textContent).toBe(
        "export const main = 1;\n",
      ),
    );
  });

  it("re-shows a workspace file already read, with no spinner and no refetch", async () => {
    // A file's bytes are content-addressed and therefore immutable, and selecting
    // one mounts a fresh body — so going back to a file just read must not put a
    // loading state over text the session is still holding.
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => `// ${url}\n`,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <VariantInputsView
        variant={variant({
          workspace: [
            { path: "src/first.ts", url: "https://cdn.example/first.ts" },
            { path: "src/second.ts", url: "https://cdn.example/second.ts" },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "src/first.ts" }));
    await waitFor(() =>
      expect(container.querySelector("code")?.textContent).toBe(
        "// https://cdn.example/first.ts\n",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "src/second.ts" }));
    await waitFor(() =>
      expect(container.querySelector("code")?.textContent).toBe(
        "// https://cdn.example/second.ts\n",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "src/first.ts" }));
    expect(screen.queryByText("Loading file…")).not.toBeInTheDocument();
    expect(container.querySelector("code")?.textContent).toBe(
      "// https://cdn.example/first.ts\n",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says a workspace file failed rather than staging a blank pane", async () => {
    // A URL of its own: successful fetches are cached module-wide by URL, so
    // reusing the lazy-fetch test's URL would replay its cached success here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })),
    );
    render(
      <VariantInputsView
        variant={variant({
          workspace: [
            { path: "src/broken.ts", url: "https://cdn.example/broken.ts" },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "src/broken.ts" }));
    expect(
      await screen.findByText("This file could not be loaded."),
    ).toBeInTheDocument();
  });

  it("says a workspace file is unavailable on a host that cannot serve it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <VariantInputsView
        variant={variant({ workspace: [{ path: "index.html", url: null }] })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "index.html" }));
    await waitFor(() =>
      expect(
        screen.getByText("This file is not available here."),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Files seeded into one run (a game jam's previous entries) read exactly like
  // the variant's own seeded files — same tree, body on the stage — under their
  // own group, so it stays clear which run they belong to.
  it("renders a run's own seeded files beside the variant's, grouped apart", () => {
    render(
      <VariantInputsView
        variant={variant({ seededInputs: [], packages: [] })}
        runSeededInputs={[
          {
            path: "previous-entries/entry-01.md",
            text: "# Space Miner\n\nDig for ore.",
          },
        ]}
      />,
    );

    expect(screen.getByText("Previous entries")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "previous-entries/entry-01.md" }),
    );
    expect(screen.getByText("Space Miner")).toBeInTheDocument();
  });
});
