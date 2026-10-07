// Reading a tool's JSON Schema back into the argument list a person would write down.
//
// The Reference page shows the schema itself — that is the artifact, and it stays the
// page's source of truth — but a pretty-printed schema answers "which of these nine
// arguments must I pass, and what goes in each" only by cross-referencing its `required`
// array against its `properties` object and its `items` against its `enum`. That is a
// mechanical read, and doing it by eye on every tool is exactly the tedium a reference
// page exists to remove.
//
// Deliberately shallow, and deliberately not a JSON Schema implementation. gg's tool
// schemas are one flat object of scalar/array-of-scalar properties (that is what the
// provider tool-call APIs accept), so this reads exactly that shape and reports what it
// cannot read rather than guessing: an unrecognized property renders as its raw type
// name, never as a confident description of something else. If the schemas ever grow
// nested objects, the raw block below the list still shows the truth in full.

/** One top-level argument of a tool, as the detail pane lists it. */
export interface ToolParameter {
  /** The property name, as the model spells it in the call. */
  name: string;
  /**
   * The property's type, rendered the way a signature would write it — `string`,
   * `string[]`, or the alternatives of an `enum` joined with `|` (which is how gg's
   * roster-bound arguments read: an `agent` property is an enum of the run's roster).
   */
  type: string;
  /** Whether the schema's `required` array names it. */
  required: boolean;
  /** The property's own `description`, or `null` for one the schema leaves undescribed. */
  description: string | null;
}

/**
 * The top-level properties of a tool's (or a variant's) parameter schema, in the order
 * the schema lists them, with `required` resolved against the sibling array.
 *
 * Returns an empty list for a schema with no properties — a tool that takes no arguments
 * — which is a real answer and not an error; the caller renders the raw schema either
 * way.
 */
export function toolParameters(
  schema: Record<string, unknown>,
): ToolParameter[] {
  const properties = asRecord(schema.properties);
  if (!properties) return [];
  // `required` is a plain array of names on every schema gg emits; a schema that omits
  // it has no required arguments, which is the same answer as an empty one.
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  return Object.entries(properties).map(([name, raw]) => {
    const property = asRecord(raw) ?? {};
    const description = property.description;
    return {
      name,
      type: schemaType(property),
      required: required.has(name),
      description: typeof description === "string" ? description : null,
    };
  });
}

/**
 * How one property's type reads in a signature.
 *
 * An `enum` wins over the `type` beside it: `"type": "string", "enum": ["<agent>"]` is a
 * choice from a fixed list, and reporting it as a bare `string` would drop the only
 * interesting half. An array recurses into its `items`, so an array of enum values reads
 * as `<agent>[]` rather than as an opaque `array`.
 */
function schemaType(property: Record<string, unknown>): string {
  const alternatives = property.enum;
  if (Array.isArray(alternatives) && alternatives.length > 0) {
    return alternatives.map((value) => String(value)).join(" | ");
  }
  const type = property.type;
  if (type === "array") {
    const items = asRecord(property.items);
    // A schema-legal array with no `items` says nothing about what is in it, so neither
    // do we — `array` is the honest answer, not `unknown[]`.
    return items ? `${schemaType(items)}[]` : "array";
  }
  if (typeof type === "string") return type;
  // A union type (`["string", "null"]`) is legal JSON Schema; nothing gg emits uses one,
  // but rendering it as its alternatives costs a line and never lies.
  if (Array.isArray(type)) {
    return type.map((value) => String(value)).join(" | ");
  }
  return "unknown";
}

/** A JSON value narrowed to an object, or `null` for anything else (including an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
