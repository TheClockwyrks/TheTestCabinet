// The provenance strip: what was measured, and under what basis.
//
// This is not decoration above the figures — it is the thing that stops a degraded
// *measurement* being read as a real change in model behaviour. Two of the analyzer's
// bases silently change what the numbers mean: an authored set that fell back to the
// whole tree includes the seeded scaffolding (so every size figure is inflated by work
// nobody's model did), and a tree measured after validation carries build output, a
// rewritten lockfile and toolchain caches (in amounts that differ per case and per run).
// Neither is visible in any figure below. Both are recorded, so both are stated here,
// with the degraded reading named as degraded rather than left to be inferred.
//
// The same goes for the caps. A truncated analysis is excluded from aggregation by
// default because a partial figure that looks complete is worse than a missing one — and
// a refused file is worse still, because it contributes every size figure while
// contributing to no complexity, API or discipline figure, so the block below it looks
// whole. Each of those states gets a sentence, and only when it actually fired.

import type {
  CodeAnalysisSummary,
  CodeLanguage,
} from "@test-cabinet/run-record/code-analysis";
import { formatCodeBytes, formatCodeNumber } from "./codeFormat";
import styles from "./CodePanels.module.scss";

/** How confident the basis is. The words carry the meaning; the tone only reinforces
 * them, so nothing here is legible by color alone. */
type Tone = "ok" | "caution" | "degraded";

interface Fact {
  label: string;
  value: string;
  note: string;
  tone: Tone;
}

const LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  typeScript: "TypeScript",
  rust: "Rust",
};

// The authored-set ladder, as the analyzer resolved it. The rung is recorded rather than
// assumed precisely because getting it wrong pollutes every figure *differently per test
// case*, silently breaking the cross-case comparison the analysis exists for.
function authoredFact(summary: CodeAnalysisSummary): Fact {
  switch (summary.authoredBasis) {
    case "seedCommit":
      return {
        label: "Authored set",
        value: "Exact",
        note: "Everything changed since the run's recorded seed commit.",
        tone: "ok",
      };
    case "rootCommit":
      return {
        label: "Authored set",
        value: "Inferred",
        note: "The seed commit was not recorded, so the tree's root commit was used — inferred from its message.",
        tone: "caution",
      };
    case "allFiles":
      return {
        label: "Authored set",
        value: "Degraded",
        note: "Neither check resolved, so the whole tree was measured: the seeded scaffolding is counted as the model's own work. Not comparable with runs measured from a seed commit.",
        tone: "degraded",
      };
  }
}

// Which state of the tree the figures describe. Pre-validation is the only basis under
// which "the code the model wrote" is literally true.
function treeFact(summary: CodeAnalysisSummary): Fact {
  return summary.treeBasis === "preValidation"
    ? {
        label: "Tree state",
        value: "Pre-validation",
        note: "Measured before the validator ran the case's install and build commands in the tree.",
        tone: "ok",
      }
    : {
        label: "Tree state",
        value: "Post-validation",
        note: "Measured after the validator built in the tree, so build output, a rewritten lockfile and toolchain caches may be counted.",
        tone: "degraded",
      };
}

function languageFact(summary: CodeAnalysisSummary): Fact {
  const names = summary.languages.map((l) => LANGUAGE_NAMES[l]);
  return {
    label: "Parsed",
    value: names.length > 0 ? names.join(" + ") : "Nothing",
    note:
      names.length > 0
        ? "Everything else in the tree — JSON, Markdown, CSS, HTML — is counted for size only."
        : "No file in the tree was in a language the analyzer parses, so only size figures were produced.",
    tone: names.length > 0 ? "ok" : "caution",
  };
}

// Every degradation the notes record, as a sentence, and only when it fired.
function notices(summary: CodeAnalysisSummary): string[] {
  const notes = summary.notes;
  const out: string[] = [];
  if (notes.truncated) {
    const reason =
      notes.truncatedBy === "fileCount"
        ? "the file-count cap fired, so later files in sorted order were never visited"
        : notes.truncatedBy === "parseBytes"
          ? "the parse-byte budget was exhausted, so later files were counted for size only"
          : notes.truncatedBy === "symbolBudget"
            ? "the symbol budget was exhausted, so later files contributed no per-function complexity"
            : "a content-derived cap fired";
    out.push(
      `Truncated — ${reason}. A truncated analysis is excluded from aggregation by default.`,
    );
  }
  if (notes.filesRefused > 0) {
    out.push(
      `${formatCodeNumber(notes.filesRefused)} source ${notes.filesRefused === 1 ? "file was" : "files were"} too large or too deeply nested to parse. They carry their size figures, but no complexity, API or discipline figure includes them.`,
    );
  }
  if (notes.filesUnparsable > 0) {
    out.push(
      `${formatCodeNumber(notes.filesUnparsable)} ${notes.filesUnparsable === 1 ? "file" : "files"} did not parse and contributed size figures only.`,
    );
  }
  if (!notes.gitignoreApplied) {
    out.push(
      "No ignore file was found, so build output and dependencies may be counted.",
    );
  }
  if (notes.filesSkipped > 0) {
    out.push(
      `${formatCodeNumber(notes.filesSkipped)} ${notes.filesSkipped === 1 ? "path" : "paths"} (${formatCodeBytes(notes.bytesSkipped)}) were removed as dependency, vendored, generated or binary content.`,
    );
  }
  return out;
}

export function CodeProvenanceStrip({
  summary,
}: {
  summary: CodeAnalysisSummary;
}) {
  const facts: Fact[] = [
    authoredFact(summary),
    treeFact(summary),
    languageFact(summary),
    {
      label: "Analyzer",
      value: `v${summary.analyzerVersion}`,
      // The version exists to make a mixed corpus visible rather than a silent step
      // change that reads as a model getting worse — and, the real reason, to license
      // improving the analyzer at all.
      note: "The generation that computed these figures. Figures are comparable only within one generation.",
      tone: "ok",
    },
  ];
  const lines = notices(summary);
  return (
    <section className={styles.provenance} aria-label="How this was measured">
      <div className={styles.provenanceFacts}>
        {facts.map((fact) => (
          <div
            key={fact.label}
            className={styles.provenanceFact}
            data-tone={fact.tone}
          >
            <span className={styles.provenanceLabel}>{fact.label}</span>
            <span className={styles.provenanceValue}>{fact.value}</span>
            <span className={styles.provenanceNote}>{fact.note}</span>
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <ul className={styles.provenanceNotices}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
