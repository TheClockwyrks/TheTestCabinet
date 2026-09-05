// The **query editor** — a transparent textarea over a syntax-highlighted layer, with
// live validation, context-sensitive completion and a menu of worked examples.
//
// No code-editor library is added. The CSP-strict public site (which runs this same
// surface off a snapshot with no backend at all) and the bundle budget both argue against
// one, and what is actually needed is small: two elements laid out identically, one
// painted and one typed into.
//
// Everything here exists because of a stated risk. Replacing a widget builder with a text
// box is a **discoverability regression** unless the text box teaches the language while
// it is being typed in, so the completion popup and the example menu are load-bearing
// rather than polish — and the completions carry **document counts**, because a sparse
// `tool.*` field has to be visible before a query returns nothing rather than after.
import {
  type KeyboardEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GgFieldCatalog, GgInterval } from "@clockwyrks/run-record/gg-query";
import { type Completion, type ParseResult, completeQuery } from "../query";
import { type QueryExample, queryExamples } from "./examples";
import { highlightSpans } from "./highlight";
import styles from "./GgDiscover.module.scss";

interface QueryEditorProps {
  /** The query source text. The editor is fully controlled — the page owns the text
   *  because the URL does. */
  value: string;
  onChange: (text: string) => void;
  /** Run the query as typed (the Enter key, and the Run control beside the editor). */
  onSubmit: () => void;
  /** The parse of {@link value}, computed by the page (which also needs it, to compile).
   *  Passing it in rather than re-parsing keeps one parse per keystroke. */
  parse: ParseResult;
  /** The corpus's fields — what completion is answered from. An empty catalog (still
   *  loading, or a transport without the endpoint) simply offers nothing. */
  catalog: GgFieldCatalog;
  /** The current range's histogram width, so the "sessions over time" example buckets at
   *  the range the operator is actually looking at. */
  interval: GgInterval;
  /** Whether a query is in flight, which disables the Run control. */
  busy?: boolean;
}

/** The class each highlight kind paints with. Looked up rather than switched so an
 *  unclassified span cannot silently render unstyled. */
const HIGHLIGHT_CLASS: Record<string, string | undefined> = {
  keyword: styles.hlKeyword,
  field: styles.hlField,
  function: styles.hlFunction,
  string: styles.hlString,
  literal: styles.hlLiteral,
  punct: styles.hlPunct,
  plain: undefined,
};

export function QueryEditor({
  value,
  onChange,
  onSubmit,
  parse,
  catalog,
  interval,
  busy = false,
}: QueryEditorProps) {
  const reactId = useId();
  const listId = `${reactId}-completions`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const spans = useMemo(
    () => highlightSpans(parse.text, parse.tokens, parse.diagnostics),
    [parse],
  );

  // Completions are computed from the *caret*, so they change as the caret moves even
  // when the text does not — clicking back into the middle of a query is exactly when an
  // operator wants to know what belongs there.
  const completions = useMemo(
    () => (open ? completeQuery(value, caret, catalog) : []),
    [open, value, caret, catalog],
  );

  const examples = useMemo<QueryExample[]>(() => queryExamples(interval), [interval]);

  // Keep the highlighted suggestion inside the list as it shrinks under a growing prefix.
  useEffect(() => {
    setHighlight((current) => (current < completions.length ? current : 0));
  }, [completions.length]);

  /** Accept a suggestion: splice its insertion over the span it replaces, and leave the
   *  caret after it so the next keystroke continues the query rather than the word. */
  const accept = useCallback(
    (completion: Completion) => {
      const next =
        value.slice(0, completion.replace.start) +
        completion.insert +
        value.slice(completion.replace.end);
      const at = completion.replace.start + completion.insert.length;
      onChange(next);
      setCaret(at);
      setOpen(true);
      // The DOM caret has to be moved after React has written the new value, or the
      // browser puts it at the end of the text.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(at, at);
      });
    },
    [onChange, value],
  );

  const syncCaret = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const listOpen = open && completions.length > 0;
    if (event.key === "ArrowDown" && listOpen) {
      event.preventDefault();
      setHighlight((current) => (current + 1) % completions.length);
      return;
    }
    if (event.key === "ArrowUp" && listOpen) {
      event.preventDefault();
      setHighlight(
        (current) => (current - 1 + completions.length) % completions.length,
      );
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Tab" && listOpen) {
      event.preventDefault();
      accept(completions[highlight]!);
      return;
    }
    if (event.key === "Enter") {
      // A newline is never meaningful in a one-line language, so Enter is free to mean
      // "accept the suggestion" while the popup is open and "run it" otherwise.
      event.preventDefault();
      if (listOpen) accept(completions[highlight]!);
      else {
        setOpen(false);
        onSubmit();
      }
    }
  };

  // The two layers scroll as one, or the painted text drifts out from under the caret on
  // a query longer than the box.
  const onScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const el = highlightRef.current;
    if (el) el.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div className={styles.editor}>
      <div className={styles.editorRow}>
        <div className={styles.editorBox}>
          {/* The painted layer. `aria-hidden` because the textarea above carries the real
              text — a screen reader must not hear the query twice. */}
          <pre ref={highlightRef} className={styles.highlight} aria-hidden="true">
            {spans.map((span, index) => (
              <span
                key={index}
                className={
                  span.invalid
                    ? `${HIGHLIGHT_CLASS[span.kind] ?? ""} ${styles.hlInvalid}`
                    : HIGHLIGHT_CLASS[span.kind]
                }
              >
                {span.text}
              </span>
            ))}
            {/* A trailing newline keeps the last line's height when the text ends bare. */}
            {"\n"}
          </pre>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={value}
            spellCheck={false}
            autoComplete="off"
            rows={1}
            aria-label="Query"
            // The ARIA combobox pattern rather than a bare text box: the popup below is a
            // listbox of suggestions, and without the pairing a screen reader announces a
            // plain textarea while sighted users get a menu.
            role="combobox"
            aria-expanded={open && completions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="state:completed and model:&quot;anthropic/*&quot; | stats avg(score) by preset"
            onChange={(event) => {
              onChange(event.target.value);
              setCaret(event.target.selectionStart);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onFocus={() => {
              syncCaret();
              setOpen(true);
            }}
            // A click on a suggestion blurs the textarea before the click lands, so the
            // popup is closed on the next frame rather than immediately.
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onScroll={onScroll}
          />
          {open && completions.length > 0 && (
            <ul className={styles.completions} id={listId} role="listbox">
              {completions.map((completion, index) => (
                <li key={`${completion.kind}:${completion.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={
                      index === highlight
                        ? `${styles.completion} ${styles.completionActive}`
                        : styles.completion
                    }
                    // `onMouseDown` rather than `onClick`: the textarea's blur fires
                    // first otherwise and the popup is gone before the click lands.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      accept(completion);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <span className={styles.completionLabel}>{completion.label}</span>
                    {completion.detail && (
                      <span className={styles.completionDetail}>{completion.detail}</span>
                    )}
                    {completion.documents !== undefined && (
                      <span className={styles.completionCount}>
                        {completion.documents.toLocaleString("en-US")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className={styles.run}
          onClick={() => {
            setOpen(false);
            onSubmit();
          }}
          disabled={busy}
        >
          {busy ? "Running…" : "Run"}
        </button>
        <button
          type="button"
          className={styles.examplesToggle}
          aria-expanded={examplesOpen}
          onClick={() => setExamplesOpen((current) => !current)}
        >
          Examples
        </button>
      </div>

      {/* Live validation. Every diagnostic is listed with its span already underlined
          above; an underline on its own is a puzzle rather than a hint. */}
      {parse.diagnostics.length > 0 && (
        <ul className={styles.diagnostics}>
          {parse.diagnostics.map((diagnostic, index) => (
            <li key={index} className={styles.diagnostic}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}

      {examplesOpen && (
        <ul className={styles.examples}>
          {examples.map((example) => (
            <li key={example.question}>
              <button
                type="button"
                className={styles.example}
                onClick={() => {
                  onChange(example.query);
                  setExamplesOpen(false);
                  setOpen(false);
                }}
              >
                <span className={styles.exampleQuestion}>{example.question}</span>
                <code className={styles.exampleQuery}>{example.query}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
