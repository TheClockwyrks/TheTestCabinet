// The Tools tab.
//
// Four properties are worth pinning, and each is one the page would still *look* right
// without. The description must survive verbatim — its newlines are the model's, and a
// renderer that reflowed them would leave a page that no longer shows what it claims to.
// A family with no tools must not appear, since an empty folder in a reference reads as a
// hole in the reference. A `?tool=` naming something this gg does not have must say so
// rather than quietly landing on the first tool, because that link is exactly how a
// renamed tool gets noticed. And an address with no `?tool=` must open on the first row of
// the *tree*: the payload's own order is the tool vocabulary's, not the families', so
// taking its first entry would highlight a row in some other folder.
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

const REFERENCE: GgReference = {
  ggVersion: "9.9.9",
  language: "typescript",
  categories: [
    {
      id: "gg-filesystem",
      title: "Filesystem",
      description: "Reading, writing and editing files in the workspace.",
      objects: ["fs"],
    },
    {
      id: "gg-shell",
      title: "Shell",
      description: "Running shell commands in the workspace.",
      objects: ["system"],
    },
    // A code-only family: it has functions but no tools, so the Tools tree must not
    // show a folder for it.
    {
      id: "gg-views",
      title: "Views",
      description:
        "Showing yourself a file, a value, or a function's documentation.",
      objects: ["view"],
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
      capability: "shell",
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
      capability: "filesystem",
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
      capability: "filesystem",
    },
  ],
  functions: [],
};

const ggReference = vi.fn().mockResolvedValue(REFERENCE);

function backendValue(): BackendContextValue {
  return { client: { ggReference } } as unknown as BackendContextValue;
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
});
