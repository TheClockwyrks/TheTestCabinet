import { useMemo, useState } from "react";
import { Markdown } from "../../../../../components/Markdown";
import type { SeededInput } from "../../../../../data/testCases";
import { variantSeededFiles } from "../../fileTree";
import type { SpecsViewProps } from "../types";
import { fence, fileTitle } from "../fence";
import styles from "./AccordionSpecs.module.scss";

// The "accordion" Specifications view, paired with the console rail: every seeded
// file is a collapsible disclosure panel stacked in one wide column, instead of a
// tree-plus-pane split. The first file opens by default and the others expand in
// place, so the whole seeded set is scannable and openable without a second
// navigation surface (the rail already owns navigation).
export function AccordionSpecs({ testCase, variant }: SpecsViewProps) {
  const files = useMemo(() => variantSeededFiles(variant), [variant]);

  if (files.length === 0) {
    return (
      <p className={styles.empty}>This variant seeds no files.</p>
    );
  }

  return (
    <div className={styles.accordion}>
      <p className={styles.lead}>
        Every run of {testCase.name} ({variant.name}) starts from a fresh
        repository containing exactly these {files.length} files.
      </p>
      <ul className={styles.list}>
        {files.map((file, index) => (
          <AccordionItem
            key={file.path}
            input={file}
            defaultOpen={index === 0}
          />
        ))}
      </ul>
    </div>
  );
}

// One file's disclosure row: a full-width header that toggles the body open. The
// body renders prose for Markdown, a fenced block for other text, the image for
// a binary — the same treatment every specs view gives a file.
function AccordionItem({
  input,
  defaultOpen,
}: {
  input: SeededInput;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <li className={open ? `${styles.item} ${styles.itemOpen}` : styles.item}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.twisty} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className={styles.path}>{fileTitle(input.path)}</span>
        <span className={styles.dir}>{input.path}</span>
        <span className={styles.kind}>{input.kind}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {input.kind === "text" && input.text !== undefined ? (
            <Markdown className={styles.prose}>
              {fence(input.path, input.text)}
            </Markdown>
          ) : input.url ? (
            <img className={styles.image} src={input.url} alt={input.path} />
          ) : null}
        </div>
      )}
    </li>
  );
}
