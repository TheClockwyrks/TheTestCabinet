// Reading a tool schema back into an argument list.
//
// The cases worth pinning are the ones where the schema says the interesting thing
// somewhere other than the obvious key: `required` lives beside `properties` rather than
// on them, and a roster-bound argument's real vocabulary is its `enum` rather than the
// `"string"` sitting next to it. A list that reported `agent: string` would be true and
// useless.
import { describe, expect, it } from "vitest";
import { toolParameters } from "./toolParameters";

describe("toolParameters", () => {
  it("resolves required against the sibling array, not against the property", () => {
    const params = toolParameters({
      type: "object",
      properties: {
        id: { type: "string", description: "The id of the task." },
        blockedBy: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    });
    expect(params.map((p) => [p.name, p.required])).toEqual([
      ["id", true],
      ["blockedBy", false],
    ]);
    expect(params[0]?.description).toBe("The id of the task.");
    // An undescribed property reports the absence rather than an empty string, so the
    // pane can drop the line instead of rendering a blank one.
    expect(params[1]?.description).toBeNull();
  });

  it("reads an enum as its alternatives, including through an array's items", () => {
    const params = toolParameters({
      type: "object",
      properties: {
        agent: { type: "string", enum: ["reviewer", "implementer"] },
        reviewers: {
          type: "array",
          items: { type: "string", enum: ["reviewer"] },
        },
      },
    });
    expect(params[0]?.type).toBe("reviewer | implementer");
    expect(params[1]?.type).toBe("reviewer[]");
  });

  it("reports what it cannot read rather than guessing", () => {
    const params = toolParameters({
      type: "object",
      properties: {
        // Schema-legal, and says nothing about its contents — so neither do we.
        anything: { type: "array" },
        untyped: {},
      },
    });
    expect(params.map((p) => p.type)).toEqual(["array", "unknown"]);
  });

  it("returns an empty list for a tool that takes no arguments", () => {
    expect(toolParameters({ type: "object" })).toEqual([]);
  });
});
