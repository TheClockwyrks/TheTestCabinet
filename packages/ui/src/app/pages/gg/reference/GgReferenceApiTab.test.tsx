// The API tab.
//
// What is worth pinning here is the grouping. The functions arrive in catalogue order —
// which begins with the *ending* call, the last family — so a tree built by walking the
// function list would present gg's surface backwards. The tree is built by walking the
// **families** and their objects instead, and this is the test that says so.
import { render, screen, within } from "@testing-library/react";
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
      id: "gg-session",
      title: "Ending the session",
      description: "Ending your session — the one call that does.",
      objects: ["harness", "review"],
    },
  ],
  tools: [],
  functions: [
    // Catalogue order: the ending call comes first, and the tree must still put it last.
    {
      object: "harness",
      name: "finish",
      category: "gg-session",
      summary: "End your session.",
      signatures: [
        {
          signature: "finish(summary: string): void",
          parameters: [
            {
              name: "summary",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "What you did, in a sentence or two.",
              fields: [],
            },
          ],
        },
      ],
      doc: "End your session, reporting what you did.",
      ending: "standard",
      library: false,
      types: [],
    },
    {
      object: "review",
      name: "approve",
      category: "gg-session",
      summary: "Approve the work.",
      signatures: [
        {
          signature: "approve(summary: string): void",
          parameters: [
            {
              name: "summary",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "Why the work is acceptable.",
              fields: [],
            },
          ],
        },
      ],
      doc: "Approve the issue's work.",
      ending: "review",
      library: false,
      types: [],
    },
    {
      object: "fs",
      name: "readFile",
      category: "gg-filesystem",
      summary: "Read a file.",
      // Two shapes on one entry, the way a language that spells an optional argument as
      // an overload pair carries it. TypeScript's own catalogue carries one; the fixture
      // carries two so the rendering of the plural case is exercised by something.
      signatures: [
        {
          signature: "readFile(path: string): FileRead",
          parameters: [
            {
              name: "path",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "The file to read.",
              fields: [],
            },
          ],
        },
        {
          signature:
            "readFile(path: string, options: { offset: number }): FileRead",
          parameters: [
            {
              name: "path",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "The file to read.",
              fields: [],
            },
            {
              name: "options",
              type: "{ offset: number }",
              optional: true,
              passing: "positional",
              doc: "The window of lines to read.",
              fields: [
                {
                  name: "offset",
                  type: "number",
                  optional: true,
                  passing: "positional",
                  doc: "The 1-based line to start at.",
                  fields: [],
                },
              ],
            },
          ],
        },
      ],
      doc: "Read a file and return its contents.",
      gate: "read_file",
      library: false,
      types: [
        {
          name: "FileRead",
          declaration: "interface FileRead {\n  text: string;\n}",
          doc: "What a read returned.",
          members: [{ name: "text", type: "string", doc: "The file's text." }],
        },
      ],
    },
  ],
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
            path="/gg/reference/api"
            element={<GgReferencePage tab="api" />}
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgReferenceApiTab", () => {
  it("groups by object in family order, not in catalogue order", async () => {
    renderAt("/gg/reference/api");
    const sidebar = await screen.findByRole("navigation", {
      name: "API objects",
    });
    const folders = within(sidebar)
      .getAllByRole("button", { expanded: true })
      .map((button) => button.getAttribute("aria-label"));
    expect(folders).toEqual([
      "fs functions",
      "harness functions",
      "review functions",
    ]);
  });

  it("opens on the tree's first function, not the payload's", async () => {
    renderAt("/gg/reference/api");
    // `functions[0]` is the ending call — last family, eleventh folder, far below the fold
    // of a sidebar that scrolls. Opening there would highlight a row nobody can see while
    // the visible top of the tree looked unselected.
    expect(
      await screen.findByRole("heading", { name: "fs.readFile" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "harness.finish" }),
    ).not.toBeInTheDocument();
  });

  it("captions each object with its family's own description", async () => {
    renderAt("/gg/reference/api");
    const sidebar = await screen.findByRole("navigation", {
      name: "API objects",
    });
    expect(
      within(sidebar).getByText(
        "Reading, writing and editing files in the workspace.",
      ),
    ).toBeInTheDocument();
  });

  it("addresses a function by object and name, and shows what binds it", async () => {
    renderAt("/gg/reference/api?fn=fs.readFile");
    expect(
      await screen.findByRole("heading", { name: "fs.readFile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bound by read_file")).toBeInTheDocument();
    expect(
      screen.getByText("readFile(path: string): FileRead"),
    ).toBeInTheDocument();
  });

  it("shows the declarations a signature refers to, explained", async () => {
    renderAt("/gg/reference/api?fn=fs.readFile");
    await screen.findByRole("heading", { name: "fs.readFile" });
    expect(screen.getByText(/interface FileRead/)).toBeInTheDocument();
    expect(screen.getByText("What a read returned.")).toBeInTheDocument();
    expect(screen.getByText("The file's text.")).toBeInTheDocument();
  });

  it("shows every shape a function is offered in, and what each argument is for", async () => {
    renderAt("/gg/reference/api?fn=fs.readFile");
    await screen.findByRole("heading", { name: "fs.readFile" });
    // Both overloads, not just the first — showing one would tell a reader half of what
    // a program may write.
    expect(
      screen.getByText("readFile(path: string): FileRead"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "readFile(path: string, options: { offset: number }): FileRead",
      ),
    ).toBeInTheDocument();
    // And a structured argument's fields, nested under it.
    expect(screen.getByText("The window of lines to read.")).toBeInTheDocument();
    expect(screen.getByText("The 1-based line to start at.")).toBeInTheDocument();
  });

  it("names the ending role for a call a role binds rather than a tool", async () => {
    renderAt("/gg/reference/api?fn=review.approve");
    expect(
      await screen.findByRole("heading", { name: "review.approve" }),
    ).toBeInTheDocument();
    expect(screen.getByText("review ending")).toBeInTheDocument();
  });
});
