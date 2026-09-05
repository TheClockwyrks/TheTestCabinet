import type { ReactNode } from "react";
import type { GgRunDataStandIn } from "@clockwyrks/run-record/gg-reference";
import { toolParameters } from "./toolParameters";
import styles from "./GgReference.module.scss";

// The blocks both Reference tabs' detail panes are built out of, and the one rule that
// makes the page worth having: **the register a piece of text is rendered in tells you
// where it came from.**
//
// - `<Verbatim>` is text gg produced for a model, exactly as gg produced it — a tool's
//   description, a documentation view's body. Never Markdown, never reflowed.
// - `<CodeBlock>` is machine-readable text (a JSON Schema), where indentation is
//   structure and lines therefore scroll.
// - `<ParameterList>` is *ours* — derived from the JSON Schema beside it, and one of the
//   few things on either page that we wrote. The prose inside its rows is still the
//   model's, read out of that same schema.
//
// A reader must never have to wonder which of those three they are looking at, which is
// why they are three components with three looks rather than one `<pre>` used everywhere.
//
// There is no argument list part. An entry
// carries the documentation view's whole body, and re-rendering the arguments beside
// it in our own layout would be a second rendering of text gg has already rendered —
// exactly the second source of truth this surface exists to not have. What it cost is
// real and is written down on `GgReferenceEntry` in the contract: no per-argument filter,
// no folding a long argument list. That is the price of showing what an agent sees.

/** A labelled block in a detail pane. */
export function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <span className={styles.sectionLabel}>{label}</span>
      {children}
    </section>
  );
}

/**
 * Model-facing text, verbatim.
 *
 * The whole reason the reference is fetched from the backend instead of being written by
 * hand is that it shows what the model is really shown; rendering the text as Markdown,
 * collapsing its blank lines or re-wrapping its hand-laid columns would quietly undo
 * that. So: a `<pre>` that wraps, and nothing else.
 *
 * `marks` is the one exception, and it is not a rendering of the text — it is a
 * highlight *over* it. See {@link markTokens}.
 */
export function Verbatim({
  label,
  text,
  marks,
}: {
  label: string;
  text: string;
  /** Placeholder tokens to mark in place; see {@link markTokens}. */
  marks?: GgRunDataStandIn[];
}) {
  return (
    <Section label={label}>
      <pre className={styles.verbatim}>{markTokens(text, marks)}</pre>
    </Section>
  );
}

/** Machine-readable text — a pretty-printed JSON Schema. */
export function CodeBlock({
  label,
  text,
  marks,
}: {
  label: string;
  text: string;
  /** Placeholder tokens to mark in place; see {@link markTokens}. */
  marks?: GgRunDataStandIn[];
}) {
  return (
    <Section label={label}>
      <pre className={styles.code}>{markTokens(text, marks)}</pre>
    </Section>
  );
}

/**
 * Highlight the **run-data placeholders** gg substituted into a tool's prose, in place.
 *
 * A handful of tool descriptions enumerate a run's own data rather than a policy —
 * `spawn_subagent` lists the roster, `read_skill` lists the library, `transition_state`
 * names the state the agent stands in — so there is no configuration-independent
 * rendering of them, and the reference is projected from a run with obvious stand-ins
 * where that data goes. A reader who does not know that reads `<agent>` as a literal and
 * concludes gg ships a tool with a broken description.
 *
 * The tokens come from the entry's own [`runData`](GgToolReference), which gg fills by
 * testing its emitted definition against the constants it substituted. This function
 * never goes looking for angle brackets: the descriptions contain those in ordinary prose
 * and in schema text, and a highlight that guessed would mark the wrong things and miss a
 * future stand-in that is not bracketed.
 *
 * The text itself is untouched — the marks are `<mark>` elements around substrings that
 * are already there — so the block still reads as exactly what the model was given, which
 * is the property the whole page rests on.
 */
export function markTokens(
  text: string,
  marks: GgRunDataStandIn[] | undefined,
): ReactNode {
  const tokens = (marks ?? []).map((mark) => mark.token).filter(Boolean);
  if (tokens.length === 0) return text;
  // One split over an alternation of the literal tokens, longest first: a token that is a
  // prefix of another (`<state>` and `<state-machine>`, say) must not win the match and
  // leave the rest of the longer one as bare text beside a highlight.
  const pattern = new RegExp(
    `(${[...tokens]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})`,
  );
  const pieces = text.split(pattern);
  // `split` with one capture group alternates plain text and captured token, so a piece is
  // a token exactly when it is one of them — no index arithmetic to get wrong when a token
  // happens to sit at the very start or end of the text.
  return pieces.map((piece, index) =>
    tokens.includes(piece) ? (
      <mark key={index} className={styles.standIn}>
        {piece}
      </mark>
    ) : (
      piece
    ),
  );
}

/** Escape a literal string for use inside a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A tool's arguments, read out of its JSON Schema.
 *
 * Rendered **above** the raw schema rather than instead of it. The schema is the artifact
 * and stays on the page as the source of truth — but "which of these must I pass" is a
 * cross-reference between two of its keys, and the answer to the question a reader
 * actually has should not be the thing they have to assemble.
 *
 * A tool's schema is ours to read in a way an API function's documentation is not: the
 * schema is data the provider is sent, not prose gg wrote for a model, so listing its
 * keys is a reading of a machine-readable structure rather than a second rendering of
 * text somebody already rendered.
 */
export function ParameterList({
  schema,
  marks,
}: {
  schema: Record<string, unknown>;
  /** Placeholder tokens to mark in the argument descriptions; see {@link markTokens}. */
  marks?: GgRunDataStandIn[];
}) {
  const parameters = toolParameters(schema);
  if (parameters.length === 0) {
    // A real answer, not a gap: several of gg's tools genuinely take nothing.
    return (
      <Section label="Parameters">
        <p className={styles.paramDesc}>No arguments.</p>
      </Section>
    );
  }
  return (
    <Section label="Parameters">
      <ul className={styles.params}>
        {parameters.map((parameter) => (
          <li key={parameter.name} className={styles.param}>
            <span className={styles.paramHead}>
              <span className={styles.paramName}>{parameter.name}</span>
              <span className={styles.paramType}>{parameter.type}</span>
              {/* Only "required" is marked — optional is the majority, and its badge
                  would stand for the default on nearly every row. */}
              {parameter.required && (
                <span className={styles.paramRequired}>required</span>
              )}
            </span>
            {parameter.description && (
              <p className={styles.paramDesc}>
                {markTokens(parameter.description, marks)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A JSON value as the page prints it: two-space indented, keys in the order the document
 * carries them.
 *
 * `JSON.stringify` preserves insertion order, and the reference documents are written by
 * `serde_json` — whose maps are sorted — so the schema a reader sees here is byte-stable
 * across reloads and diffable against the wire form.
 */
export function printJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
