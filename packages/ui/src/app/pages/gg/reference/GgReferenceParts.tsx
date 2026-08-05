import type { ReactNode } from "react";
import type { GgApiParameter } from "@test-cabinet/run-record/gg-reference";
import { toolParameters } from "./toolParameters";
import styles from "./GgReference.module.scss";

// The three blocks both Reference tabs' detail panes are built out of, and the one rule
// that makes the page worth having: **the register a piece of text is rendered in tells
// you where it came from.**
//
// - `<Verbatim>` is prose a model is given, exactly as it is given — never Markdown,
//   never reflowed.
// - `<CodeBlock>` is machine-readable text (a JSON Schema, a signature, a type
//   declaration), where indentation is structure and lines therefore scroll.
// - `<ParameterList>` and `<ApiParameterList>` are *ours* — derived from the schema or
//   the signature catalogue beside them, and the only thing on either page that we wrote.
//   The prose inside their rows is still the model's, reflected from the same place.
//
// A reader must never have to wonder which of those three they are looking at, which is
// why they are three components with three looks rather than one `<pre>` used everywhere.

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
 * Model-facing prose, verbatim.
 *
 * The whole reason the reference is fetched from the backend instead of being written by
 * hand is that it shows what the model is really shown; rendering the text as Markdown,
 * collapsing its blank lines or re-wrapping its hand-laid columns would quietly undo
 * that. So: a `<pre>` that wraps, and nothing else.
 */
export function Verbatim({ label, text }: { label: string; text: string }) {
  return (
    <Section label={label}>
      <pre className={styles.verbatim}>{text}</pre>
    </Section>
  );
}

/** Machine-readable text — pretty-printed JSON, a TypeScript signature, a declaration. */
export function CodeBlock({
  label,
  text,
  wrap = false,
}: {
  label: string;
  text: string;
  /**
   * Let long lines fold instead of scrolling sideways.
   *
   * Off by default, because in a pretty-printed schema or a type declaration the
   * indentation *is* the structure and folding a line moves it under the wrong key. A
   * function signature is the exception the flag exists for: it is one logical line with
   * no indentation to destroy, so scrolling it sideways would cost a reader the return
   * type — the half they came for — for nothing.
   */
  wrap?: boolean;
}) {
  return (
    <Section label={label}>
      <pre className={wrap ? `${styles.code} ${styles.codeWrap}` : styles.code}>
        {text}
      </pre>
    </Section>
  );
}

/**
 * A tool's arguments, read out of its JSON Schema.
 *
 * Rendered **above** the raw schema rather than instead of it. The schema is the artifact
 * and stays on the page as the source of truth — but "which of these must I pass" is a
 * cross-reference between two of its keys, and the answer to the question a reader
 * actually has should not be the thing they have to assemble.
 */
export function ParameterList({ schema }: { schema: Record<string, unknown> }) {
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
              <p className={styles.paramDesc}>{parameter.description}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * An API function's arguments, read out of the signature catalogue rather than a JSON
 * Schema.
 *
 * The sibling of {@link ParameterList}, which does the same job for a *tool*. They are
 * two functions rather than one because the two surfaces carry their arguments in
 * genuinely different shapes — a tool's are a JSON Schema the provider is sent, an API
 * function's are reflected out of the SDK's own `@param` blocks — and flattening them
 * into a shared row type would mean neither could ever say anything the other cannot.
 * A structured argument's fields nest under it, because that is where a model writes
 * them.
 */
export function ApiParameterList({
  parameters,
}: {
  parameters: GgApiParameter[];
}) {
  if (parameters.length === 0) {
    // A real answer, not a gap: `view.current()` and `programs.history()` take nothing.
    return <p className={styles.paramDesc}>No arguments.</p>;
  }
  return (
    <ul className={styles.params}>
      {parameters.map((parameter) => (
        <li key={parameter.name} className={styles.param}>
          <span className={styles.paramHead}>
            <span className={styles.paramName}>{parameter.name}</span>
            <span className={styles.paramType}>{parameter.type}</span>
            {/* Only "required" is marked, the same rule the tool rows follow. */}
            {!parameter.optional && (
              <span className={styles.paramRequired}>required</span>
            )}
            {/* A default is worth a row of its own only where the language states one;
                TypeScript never does, so this is silent today and will not be for a
                language that spells options as defaults. */}
            {parameter.default !== undefined && (
              <span className={styles.paramType}>= {parameter.default}</span>
            )}
            {/* How the argument is passed is marked only when it changes what a model
                types. Positional is every argument in every language that passes by
                position, so labelling those would say nothing; `by name` is Python's
                keyword arguments and Kotlin's named ones, where the call site writes the
                name too. */}
            {parameter.passing === "keyword" && (
              <span className={styles.paramType}>by name</span>
            )}
          </span>
          <p className={styles.paramDesc}>{parameter.doc}</p>
          {parameter.fields.length > 0 && (
            <ApiParameterList parameters={parameter.fields} />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A JSON value as the page prints it: two-space indented, keys in the order the artifact
 * carries them.
 *
 * `JSON.stringify` preserves insertion order, and the committed artifact was produced by
 * `serde_json` — whose maps are sorted — so the schema a reader sees here is byte-stable
 * across reloads and diffable against the wire form.
 */
export function printJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
