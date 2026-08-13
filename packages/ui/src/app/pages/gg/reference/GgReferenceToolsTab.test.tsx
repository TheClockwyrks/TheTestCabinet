// The Tools tab.
//
// Six properties are worth pinning here, and each is one the page would still *look*
// right without. The description must survive verbatim — its newlines are the model's, and
// a renderer that reflowed them would leave a page that no longer shows what it claims to.
// A family with no tools must not appear, since an empty folder in a reference reads as a
// hole in the reference. A `?tool=` naming something this gg does not have must say so
// rather than quietly landing on the first tool, because that link is exactly how a
// renamed tool gets noticed. And an address with no `?tool=` must open on the first row of
// the *tree*: the payload's own order is the tool vocabulary's, not the families', so
// taking its first entry would highlight a row in some other folder.
//
// The last two are what the eleven-arm reference added. Every capability that buys a tool
// has to be named, not just one of them — `fork` needs two, and a page that showed one
// would acquit the other. And the run-data stand-ins have to be marked and explained,
// because `<agent>` in a description reads as a broken tool to anyone who does not know
// the reference is projected from a run that has no roster of its own.
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GgReference } from "@test-cabinet/run-record/gg-reference";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import { GgReferencePage } from "./GgReferencePage";

vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

/** A description whose line breaks are load-bearing — the thing `pre-wrap` is for. */
const READ_FILE_DESCRIPTION =
  "Read a file and return its contents.\n\nText files are returned as text.";

/**
 * A description that enumerates a run's own roster, so the reference carries a stand-in
 * where the roster would be. The angle-bracketed prose beside it is deliberate: the page
 * must mark the token because the document said it is one, never because it went looking
 * for angle brackets.
 */
const SPAWN_DESCRIPTION =
  "Delegate work to a child agent. The agents you may spawn: `<agent>`. " +
  "Spawning fails if you are already at <the maximum depth>.";

const REFERENCE: GgReference = {
  ggVersion: "9.9.9",
  categories: [
    {
      id: "gg-filesystem",
      title: "Filesystem",
      description: "Reading, writing and editing files in the workspace.",
    },
    {
      id: "gg-shell",
      title: "Shell",
      description: "Running shell commands in the workspace.",
    },
    {
      id: "gg-delegation",
      title: "Delegation",
      description: "Handing scoped work to child agents.",
    },
    // A code-only family: it has responses-as-code functions but no tools, so the Tools
    // tree must not show a folder for it.
    {
      id: "gg-views",
      title: "Views",
      description:
        "Showing yourself a file, a value, or a function's documentation.",
    },
  ],
  // In the canonical vocabulary order, exactly as the payload arrives — which is *not*
  // the family order the tree is grouped by: `shell` leads the vocabulary while
  // Filesystem leads the families. That mismatch is the whole reason the opening
  // selection has to be read off the tree rather than off this array.
  tools: [
    {
      name: "shell",
      category: "gg-shell",
      description: "Run a shell command.",
      parameters: { type: "object", properties: {} },
      capabilities: ["shell"],
    },
    {
      name: "read_file",
      category: "gg-filesystem",
      description: READ_FILE_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read." },
        },
        required: ["path"],
      },
      capabilities: ["filesystem"],
      variants: [
        {
          label: "read mode: default-cap",
          description: "Read a file, up to 2000 lines.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, limit: { type: "number" } },
            required: ["path"],
          },
        },
      ],
    },
    {
      name: "list_dir",
      category: "gg-filesystem",
      description: "List a directory.",
      parameters: { type: "object", properties: {} },
      capabilities: ["filesystem"],
    },
    // Two capabilities, a condition beyond them, and a stand-in in both the description
    // and the schema — the tool that exercises everything the index gained.
    {
      name: "spawn_subagent",
      category: "gg-delegation",
      description: SPAWN_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "One of: `<agent>`.",
          },
        },
        required: ["agent"],
      },
      capabilities: ["subagents", "fork"],
      requires: [
        {
          sentence:
            "Only when the agent's roster lists at least one agent it may spawn.",
          axes: ["roster"],
        },
      ],
      runData: [
        {
          token: "<agent>",
          standsFor: "the agents on this run's own roster",
        },
      ],
    },
  ],
  languages: [
    { id: "typescript", moduleCount: 1, functionCount: 1, typeCount: 0 },
  ],
};

const ggReference = vi.fn().mockResolvedValue(REFERENCE);
const ggReferenceApi = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { ggReference, ggReferenceApi },
  } as unknown as BackendContextValue;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route
            path="/gg/reference/tools"
            element={<GgReferencePage tab="tools" />}
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgReferenceToolsTab", () => {
  it("lists only the families that have tools, and opens on the first tool", async () => {
    renderAt("/gg/reference/tools");
    const sidebar = await screen.findByRole("navigation", { name: "Tools" });
    expect(
      within(sidebar).getByRole("button", { name: "Filesystem tools" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("button", { name: "Views tools" }),
    ).not.toBeInTheDocument();
    // No `?tool=`: the pane shows the first tool of the *tree* rather than nothing — and
    // not `tools[0]`, which is `shell`, in the folder below.
    expect(
      await screen.findByRole("heading", { name: "read_file" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "shell" }),
    ).not.toBeInTheDocument();
  });

  it("renders the description verbatim, with its own line breaks", async () => {
    renderAt("/gg/reference/tools?tool=read_file");
    const description = await screen.findByText(
      /Read a file and return its contents/,
    );
    expect(description.textContent).toBe(READ_FILE_DESCRIPTION);
  });

  it("derives the argument list from the schema and keeps the schema itself", async () => {
    renderAt("/gg/reference/tools?tool=read_file");
    await screen.findByRole("heading", { name: "read_file" });
    // `getAll`, because the folded variant below carries its own copy of every one of
    // these — which is the point of the variant, not a duplicate of the default.
    expect(screen.getAllByText("path").length).toBeGreaterThan(0);
    expect(screen.getAllByText("required").length).toBeGreaterThan(0);
    // The raw schema stays on the page as the source of truth for the list above it.
    expect(screen.getAllByText(/"properties":/).length).toBeGreaterThan(0);
  });

  it("says so when a link names a tool this gg does not have", async () => {
    renderAt("/gg/reference/tools?tool=read_fyle");
    await waitFor(() =>
      expect(screen.getByText(/No tool named/)).toBeInTheDocument(),
    );
    // Emphatically NOT a silent fall back to the first tool.
    expect(
      screen.queryByRole("heading", { name: "read_file" }),
    ).not.toBeInTheDocument();
  });

  it("offers a tool's other configurations without burying the default", async () => {
    renderAt("/gg/reference/tools?tool=read_file");
    await screen.findByRole("heading", { name: "read_file" });
    const variant = screen.getByText("read mode: default-cap");
    // Folded away: the default configuration's own schema is what leads the pane.
    expect(variant.closest("details")?.open).toBe(false);
  });

  it("names every capability a tool needs, not one of them", async () => {
    renderAt("/gg/reference/tools?tool=spawn_subagent");
    await screen.findByRole("heading", { name: "spawn_subagent" });
    // `fork` needs the capability of its own name *and* the one that buys the calls
    // collecting the copy. A single-valued field answered for one and acquitted the other,
    // which is why the wire carries a list and why this asserts on both.
    expect(screen.getByText("subagents")).toBeInTheDocument();
    expect(screen.getByText("fork")).toBeInTheDocument();
  });

  it("states the conditions beyond the capabilities, in gg's own words", async () => {
    renderAt("/gg/reference/tools?tool=spawn_subagent");
    await screen.findByRole("heading", { name: "spawn_subagent" });
    // The sentence is gg's, composed against its own tool registry rather than restated here.
    // The console renders a string it never wrote, which is what makes it checkable.
    expect(
      screen.getByText(
        "Only when the agent's roster lists at least one agent it may spawn.",
      ),
    ).toBeInTheDocument();
  });

  it("marks the run-data stand-ins in place and says what they stand for", async () => {
    renderAt("/gg/reference/tools?tool=spawn_subagent");
    await screen.findByRole("heading", { name: "spawn_subagent" });

    // Marked where it stands, in the description and in the schema's own prose — a
    // reader meeting `<agent>` unmarked reads it as a literal and concludes gg ships a
    // broken tool.
    const marks = screen
      .getAllByText("<agent>")
      .filter((node) => node.tagName === "MARK");
    expect(marks.length).toBeGreaterThan(0);
    // And explained once, from the document's own `runData` rather than from anything
    // this page inferred.
    expect(
      screen.getByText(/the agents on this run's own roster/),
    ).toBeInTheDocument();

    // The description still reads exactly as the model was given it: marking is a
    // highlight over the bytes, never an edit to them.
    const description = screen.getByText(/Delegate work to a child agent/);
    expect(description.textContent).toBe(SPAWN_DESCRIPTION);
  });

  it("does not mark angle-bracketed prose the document did not call a stand-in", async () => {
    renderAt("/gg/reference/tools?tool=spawn_subagent");
    await screen.findByRole("heading", { name: "spawn_subagent" });
    // `<the maximum depth>` is ordinary prose. A page that highlighted it would be
    // guessing from punctuation — which is exactly what keying on `runData` avoids, and
    // what would silently miss a future stand-in that is not bracketed.
    //
    // Asserted over the marks themselves rather than by looking the phrase up: it is a
    // fragment of a longer text node, so a query for it finds nothing whether or not the
    // page marked anything, and a test that passes either way pins nothing.
    const marked = Array.from(document.querySelectorAll("mark")).map(
      (node) => node.textContent,
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(marked).not.toContain("<the maximum depth>");
    expect(new Set(marked)).toEqual(new Set(["<agent>"]));
  });
});
