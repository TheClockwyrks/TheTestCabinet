import { useMemo, useState } from "react";
import { Markdown } from "../../../../../components/Markdown";
import type { SeededInput } from "../../../../../data/testCases";
import type { SpecsViewProps } from "../types";
import { fence, fileTitle } from "../fence";
import styles from "./DeckSpecs.module.scss";

// The "deck" Specifications view, paired with the cartridge shell: the seeded
// files become editor-style tabs across the top of a framed "monitor" pane, and
// the reference screenshots run along the bottom as a filmstrip. It trades the
// tree for a flat row of open files — fewer files than a tree implies, surfaced
// all at once — and gives the visual targets first-class space.
export function DeckSpecs({ testCase, variant }: SpecsViewProps) {
  const files = variant.seededInputs;
  const screenshots = variant.referenceScreenshots;

  // Default to the first text file (the natural entry point), falling back to the
  // first file of any kind.
  const initial = useMemo(() => {
    const firstText = files.find((file) => file.kind === "text");
    return (firstText ?? files[0])?.path ?? null;
  }, [files]);
  const [activePath, setActivePath] = useState<string | null>(initial);

  const active =
    files.find((file) => file.path === activePath) ??
    files.find((file) => file.path === initial) ??
    null;

  if (files.length === 0) {
    return <p className={styles.empty}>This variant seeds no files.</p>;
  }

  return (
    <div className={styles.deck}>
      <p className={styles.lead}>
        Every run of {testCase.name} ({variant.name}) starts from a fresh
        repository containing exactly these files.
      </p>

      <div className={styles.monitor}>
        <div className={styles.chrome}>
          <span className={styles.lights} aria-hidden="true">
            <span className={`${styles.light} ${styles.lightA}`} />
            <span className={`${styles.light} ${styles.lightB}`} />
            <span className={`${styles.light} ${styles.lightC}`} />
          </span>
          <div className={styles.tabs} role="tablist" aria-label="Seeded files">
            {files.map((file) => {
              const selected = file.path === active?.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={
                    selected ? `${styles.tab} ${styles.tabActive}` : styles.tab
                  }
                  onClick={() => setActivePath(file.path)}
                >
                  {fileTitle(file.path)}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.screen}>
          {active ? <FileBody input={active} /> : null}
        </div>
      </div>

      {screenshots.length > 0 && (
        <section className={styles.filmstrip}>
          <h2 className={styles.filmstripTitle}>Reference screenshots</h2>
          <div className={styles.frames}>
            {screenshots.map((shot) => (
              <figure key={shot.view} className={styles.frame}>
                <img
                  className={styles.frameImage}
                  src={shot.url}
                  alt={`${variant.name} ${shot.view}`}
                />
                <figcaption className={styles.frameCaption}>
                  {shot.view}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// The active file's body inside the monitor screen: the path line, then prose
// for Markdown, a fenced block for other text, the image for a binary.
function FileBody({ input }: { input: SeededInput }) {
  return (
    <article className={styles.file}>
      <header className={styles.fileHead}>
        <span className={styles.filePath}>{input.path}</span>
        <span className={styles.fileKind}>{input.kind}</span>
      </header>
      {input.kind === "text" && input.text !== undefined ? (
        <Markdown className={styles.fileProse}>
          {fence(input.path, input.text)}
        </Markdown>
      ) : input.url ? (
        <img className={styles.fileImage} src={input.url} alt={input.path} />
      ) : null}
    </article>
  );
}
