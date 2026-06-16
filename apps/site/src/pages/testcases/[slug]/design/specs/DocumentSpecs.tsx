import { useMemo } from "react";
import { Markdown } from "../../../../../components/Markdown";
import type { SeededInput } from "../../../../../data/testCases";
import type { SpecsViewProps } from "../types";
import { fence, fileAnchor, fileTitle } from "../fence";
import styles from "./DocumentSpecs.module.scss";

// The "document" Specifications view: rather than picking one file at a time in a
// tree, every seeded file is laid out as a titled section in a single scrolling
// document, with a sticky outline on the left that jumps to each one. It reframes
// the specs as something to *read* top-to-bottom, the way a model receives them,
// with the reference screenshots collected into a gallery at the end. The chrome
// is unchanged, so this is the "only rework Specifications" option.
export function DocumentSpecs({ testCase, variant }: SpecsViewProps) {
  // Text seeds render as prose/code sections; image seeds (rare in the spec set)
  // render inline. Reference screenshots get their own gallery section.
  const files = variant.seededInputs;
  const screenshots = variant.referenceScreenshots;

  const outline = useMemo(() => {
    const entries = files.map((file) => ({
      id: fileAnchor(file.path),
      label: fileTitle(file.path),
      path: file.path,
    }));
    if (screenshots.length > 0) {
      entries.push({
        id: "spec-reference-screenshots",
        label: "Reference screenshots",
        path: "reference/",
      });
    }
    return entries;
  }, [files, screenshots]);

  return (
    <div className={styles.document}>
      <nav className={styles.outline} aria-label="Specification contents">
        <p className={styles.outlineHead}>
          {testCase.name} · {variant.name}
        </p>
        <ol className={styles.outlineList}>
          {outline.map((entry) => (
            <li key={entry.id}>
              <a className={styles.outlineLink} href={`#${entry.id}`}>
                {entry.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.pages}>
        <p className={styles.lead}>
          Every run of {testCase.name} ({variant.name}) starts from a fresh
          repository containing exactly these files, read here end to end.
        </p>

        {files.map((file) => (
          <FileSection key={file.path} input={file} />
        ))}

        {screenshots.length > 0 && (
          <section
            id="spec-reference-screenshots"
            className={styles.section}
          >
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Reference screenshots</h2>
              <span className={styles.sectionKind}>targets</span>
            </header>
            <p className={styles.sectionNote}>
              Visual targets only — these are not seeded into a run.
            </p>
            <div className={styles.gallery}>
              {screenshots.map((shot) => (
                <figure key={shot.view} className={styles.shot}>
                  <img
                    className={styles.shotImage}
                    src={shot.url}
                    alt={`${variant.name} ${shot.view}`}
                  />
                  <figcaption className={styles.shotCaption}>
                    {shot.view}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// One seeded file as a document section: a path header, then the contents —
// prose for Markdown, a fenced code block for other text, the image for a binary.
function FileSection({ input }: { input: SeededInput }) {
  return (
    <section id={fileAnchor(input.path)} className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{fileTitle(input.path)}</h2>
        <span className={styles.sectionPath}>{input.path}</span>
      </header>
      {input.kind === "text" && input.text !== undefined ? (
        <Markdown className={styles.sectionBody}>
          {fence(input.path, input.text)}
        </Markdown>
      ) : input.url ? (
        <img className={styles.sectionImage} src={input.url} alt={input.path} />
      ) : null}
    </section>
  );
}
