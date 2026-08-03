import { useMemo } from "react";
import type {
  GgReference,
  GgReferenceCategory,
  GgToolReference,
} from "@test-cabinet/run-record/gg-reference";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
} from "../../runs/gg/GgFsExplorer";
import {
  CodeBlock,
  ParameterList,
  Section,
  Verbatim,
  printJson,
} from "./GgReferenceParts";
import { useEntrySelection, useRevealSelection } from "./referenceSelection";
import panels from "../../runs/gg/GgPanels.module.scss";
import styles from "./GgReference.module.scss";

// The **Tools** tab: every tool gg can put in front of a model, grouped by family, with
// the selected one's wire definition — the description and the JSON Schema, exactly as
// they are sent.
//
// It is laid out as one of gg's filesystem explorers, and imported straight across from
// `pages/runs/gg` rather than moved to a shared home. The trio (`FsExplorer` /
// `FsFolder` / `FsFileRow`) is already the shared component its own docs say it is — the
// three run-view explorers exist precisely because the *shape* was extracted from them —
// and its markup invariants live in `GgPanels.module.scss`, which comes along with the
// import. Relocating it would move a stylesheet the three existing call sites are also
// reading from, touching four files to change nothing observable; the import path is the
// only cost of leaving it, and it is one line.
//
// Why an explorer at all: the reference is a two-level document (families holding tools)
// where a reader picks one entry and reads it whole, which is the tree's exact shape —
// and using the same tree the run views use means the family a tool sits in reads the
// same here as it does when you are staring at what an agent actually called.
//
// This is the tab's *body*, not a page: the frame around it — the header, the tab bar and
// the fetch both tabs read from — is `GgReferencePage`'s, and lives above the two so
// switching tabs does not throw the document away. See `GgReferencePage.tsx`.

/** One family's folder in the sidebar: the category, and the tools that named it. */
interface ToolGroup {
  category: GgReferenceCategory;
  tools: GgToolReference[];
}

export function GgReferenceToolsTab({ reference }: { reference: GgReference }) {
  const folders = useFsFolders();
  const { requested, select } = useEntrySelection("tool");

  // Families in the payload's own order — the order gg's system prompt and skills index
  // list them in — each holding the tools that named it. A family with no tools at all
  // (Views, Program library, Ending the session are code-only) is dropped rather than
  // shown empty: an empty folder in a reference reads as a gap in the reference.
  //
  // Nothing lands outside a family: `crates/gg/src/reference.test.rs` asserts every tool
  // maps to a real category, which is what makes this grouping total.
  const groups = useMemo<ToolGroup[]>(
    () =>
      reference.categories
        .map((category) => ({
          category,
          tools: reference.tools.filter(
            (tool) => tool.category === category.id,
          ),
        }))
        .filter((group) => group.tools.length > 0),
    [reference],
  );

  // An address with no `?tool=` opens on the first tool rather than on nothing, so the
  // page teaches what it is by showing one. That first tool is the first row of the
  // **tree**, not of `reference.tools` — the payload is in the canonical vocabulary order,
  // which is not the family order the sidebar is grouped by, so taking `tools[0]` would
  // highlight a row in some other folder and read as though the pane had opened something
  // at random. An address that names a tool this gg does not have resolves to nothing on
  // purpose — see `useEntrySelection`.
  const selected =
    requested == null
      ? (groups[0]?.tools[0] ?? null)
      : (reference.tools.find((tool) => tool.name === requested) ?? null);

  // Thirty-seven tools scroll past the fold, so a link to one in a late family would
  // otherwise open beside a tree still showing the first.
  useRevealSelection(requested != null, selected != null);

  return (
    <FsExplorer
      sidebarLabel="Tools"
      tree={groups.map((group) => (
        <FsFolder
          key={group.category.id}
          depth={0}
          // Open by default, every one of them. A run explorer closes the folders a live
          // stream can flood; this document is fixed at 37 entries and is *read by
          // scanning*, so hiding four fifths of it behind carets would cost the page the
          // one thing an index is for.
          open={folders.isOpen(group.category.id, true)}
          onToggle={() => folders.toggle(group.category.id, true)}
          ariaLabel={`${group.category.title} tools`}
          name={group.category.title}
          meta={
            <span className={panels.fsMeta} title={group.category.description}>
              {group.tools.length}
            </span>
          }
        >
          {group.tools.map((tool) => (
            <FsFileRow
              key={tool.name}
              depth={1}
              selected={selected?.name === tool.name}
              onSelect={() => select(tool.name)}
              ariaLabel={`tool ${tool.name}`}
              name={tool.name}
            />
          ))}
        </FsFolder>
      ))}
    >
      {selected ? (
        <ToolDetail
          tool={selected}
          category={
            reference.categories.find(
              (category) => category.id === selected.category,
            ) ?? null
          }
        />
      ) : (
        <div className={panels.panelBody}>
          <p className={styles.empty}>
            No tool named <code>{requested}</code> in gg {reference.ggVersion} —
            it may have been renamed or dropped since that link was written.
            Pick one from the list.
          </p>
        </div>
      )}
    </FsExplorer>
  );
}

// One tool, in the order the questions get asked: what is it and what switches it on,
// what is the model told about it, what may it pass, and — for the handful whose shape
// depends on how their capability is configured — what a differently-configured run
// would see instead.
function ToolDetail({
  tool,
  category,
}: {
  tool: GgToolReference;
  /** The tool's family, or `null` if the payload somehow names one it does not carry. */
  category: GgReferenceCategory | null;
}) {
  return (
    <div className={panels.panelBody}>
      <div className={styles.detail}>
        <header className={styles.detailHead}>
          <h2 className={styles.detailTitle}>{tool.name}</h2>
          <div className={styles.meta}>
            <span className={styles.chip}>
              {category?.title ?? tool.category}
            </span>
            {/* The capability is the fact a reader is usually here for: it is what they
                would switch on in a gg configuration to get this tool. */}
            {tool.capability && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                {tool.capability}
              </span>
            )}
            {tool.variants && tool.variants.length > 0 && (
              <span className={styles.chip}>
                {tool.variants.length} other configuration
                {tool.variants.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {/* Everything the capability alone does not decide — a bound store, a memory
              strategy, a position in a machine — and the warning, where it applies, that
              the description below enumerates one run's roster rather than the tool's own
              vocabulary. */}
          {tool.note && <p className={styles.note}>{tool.note}</p>}
        </header>

        <Verbatim label="Description" text={tool.description} />
        <ParameterList schema={tool.parameters} />
        {/* The schema stays on the page under the list derived from it: the list is a
            reading of this, and a reader checking an edge case should not have to take
            our word for the reading. */}
        <CodeBlock label="JSON Schema" text={printJson(tool.parameters)} />

        {tool.variants && tool.variants.length > 0 && (
          <Section label="Other configurations">
            <div className={styles.variants}>
              {tool.variants.map((variant) => (
                <details key={variant.label} className={styles.variant}>
                  <summary className={styles.variantSummary}>
                    <span className={styles.variantLabel}>{variant.label}</span>
                  </summary>
                  <div className={styles.variantBody}>
                    <Verbatim label="Description" text={variant.description} />
                    <ParameterList schema={variant.parameters} />
                    <CodeBlock
                      label="JSON Schema"
                      text={printJson(variant.parameters)}
                    />
                  </div>
                </details>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
