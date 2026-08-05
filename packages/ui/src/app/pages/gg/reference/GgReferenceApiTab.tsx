import { useMemo } from "react";
import type {
  GgApiFunction,
  GgReference,
  GgReferenceCategory,
} from "@test-cabinet/run-record/gg-reference";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
} from "../../runs/gg/GgFsExplorer";
import { fsIndent } from "../../runs/gg/ggFsTree";
import { ApiParameterList, Section, Verbatim } from "./GgReferenceParts";
import { useEntrySelection, useRevealSelection } from "./referenceSelection";
import panels from "../../runs/gg/GgPanels.module.scss";
import styles from "./GgReference.module.scss";

// The **API** tab: every function a responses-as-code program can call, grouped by the
// object it hangs off.
//
// Grouped by object rather than by family because that is how a program reaches them —
// `fs.readFile`, not "the filesystem family's read call" — and because the objects are
// what a model itself enumerates mid-run with `object.list()`. The *order* is still the
// families', so the two tabs walk gg's surface in the same sequence, and each object
// carries its family's own one-line description as a caption: which of thirteen objects
// you want is a question the object names alone do not answer.
//
// The whole tab is the same material a program gets back from `view.openDocsView(...)`,
// reflected out of the guest SDK's emitted declarations — so what is read here and what
// a model can look up for itself mid-session cannot disagree.
//
// This is the tab's *body*, not a page: the frame around it — the header, the tab bar and
// the fetch both tabs read from — is `GgReferencePage`'s, and lives above the two so
// switching tabs does not throw the document away. See `GgReferencePage.tsx`.

/** One object's folder in the sidebar: the object, the family it came from, its functions. */
interface ObjectGroup {
  object: string;
  category: GgReferenceCategory;
  functions: GgApiFunction[];
}

/** How a function is addressed, in the URL and in the tree: `fs.readFile`. */
function functionId(fn: GgApiFunction): string {
  return `${fn.object}.${fn.name}`;
}

export function GgReferenceApiTab({ reference }: { reference: GgReference }) {
  const folders = useFsFolders();
  const { requested, select } = useEntrySelection("fn");

  // Objects in family order, and within a family in the order the family declares them
  // (which matters for exactly one family: the ending call's `harness` / `review` /
  // `judge` are three spellings of one thing, one per agent role, and they read as a set
  // in that order). An object with no functions is dropped — the payload should carry
  // none, but a folder with nothing in it would be a claim that gg offers an object a
  // program cannot call anything on.
  const groups = useMemo<ObjectGroup[]>(
    () =>
      reference.categories
        .flatMap((category) =>
          category.objects.map((object) => ({
            object,
            category,
            functions: reference.functions.filter((fn) => fn.object === object),
          })),
        )
        .filter((group) => group.functions.length > 0),
    [reference],
  );

  // With no `?fn=`, the pane opens on the first row of the **tree** — not on
  // `reference.functions[0]`. The payload is in catalogue order, which begins with the
  // *ending* call (the last family), so the first entry of the array sits eleven folders
  // down a sidebar that scrolls: the pane would open on something the reader cannot see
  // is selected, and the tree would look as though nothing were. Walking the groups is
  // the same walk the sidebar below does, so the highlight is always its first row.
  const selected =
    requested == null
      ? (groups[0]?.functions[0] ?? null)
      : (reference.functions.find((fn) => functionId(fn) === requested) ??
        null);

  // Thirteen folders of functions scroll well past the fold, so a link to `judge.verdict`
  // would otherwise open beside a tree still showing `fs`.
  useRevealSelection(requested != null, selected != null);

  return (
    <FsExplorer
      sidebarLabel="API objects"
      tree={groups.map((group) => (
        <FsFolder
          key={group.object}
          depth={0}
          // Open by default, like the Tools tree: this is a fixed document read by
          // scanning, not a live stream that needs collapsing.
          open={folders.isOpen(group.object, true)}
          onToggle={() => folders.toggle(group.object, true)}
          ariaLabel={`${group.object} functions`}
          name={group.object}
          meta={<span className={panels.fsMeta}>{group.functions.length}</span>}
        >
          {/* The family's own line, as the folder's first child rather than as a second
              line in its row — see `.objectCaption`. `fsIndent(1)` is the same inline
              indent the function rows below take, which is what puts it in their column
              instead of against the sidebar's edge. */}
          <li className={styles.objectCaption} style={fsIndent(1)}>
            {group.category.description}
          </li>
          {group.functions.map((fn) => (
            <FsFileRow
              key={functionId(fn)}
              depth={1}
              selected={
                selected != null && functionId(selected) === functionId(fn)
              }
              onSelect={() => select(functionId(fn))}
              ariaLabel={`function ${functionId(fn)}`}
              name={fn.name}
            />
          ))}
        </FsFolder>
      ))}
    >
      {selected ? (
        <FunctionDetail
          fn={selected}
          category={
            reference.categories.find(
              (category) => category.id === selected.category,
            ) ?? null
          }
        />
      ) : (
        <div className={panels.panelBody}>
          <p className={styles.empty}>
            No function named <code>{requested}</code> in gg{" "}
            {reference.ggVersion} — it may have been renamed or dropped since
            that link was written. Pick one from the list.
          </p>
        </div>
      )}
    </FsExplorer>
  );
}

// One function: how it is bound, how it is called, what it does, and the declarations its
// signature leans on.
function FunctionDetail({
  fn,
  category,
}: {
  fn: GgApiFunction;
  /** The function's family, or `null` if the payload names one it does not carry. */
  category: GgReferenceCategory | null;
}) {
  return (
    <div className={panels.panelBody}>
      <div className={styles.detail}>
        <header className={styles.detailHead}>
          <h2 className={styles.detailTitle}>
            {fn.object}.{fn.name}
          </h2>
          <div className={styles.meta}>
            <span className={styles.chip}>
              {category?.title ?? fn.category}
            </span>
            {/* What binds the call, in the one vocabulary that actually decides it. Most
                functions are bound by a *tool* being enabled — responses as code is the
                same surface as the toolset, reached differently — while the ending call
                is bound by the agent's role and the library calls by a capability, which
                is why three separate fields exist rather than one "gate" string. */}
            {fn.gate && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                bound by {fn.gate}
              </span>
            )}
            {fn.ending && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                {fn.ending} ending
              </span>
            )}
            {fn.library && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                program library
              </span>
            )}
            {/* Nothing gates a view function: every program gets them whatever a run
                enables, and saying so is more useful than an empty metadata row. */}
            {!fn.gate && !fn.ending && !fn.library && (
              <span className={styles.chip}>always available</span>
            )}
          </div>
        </header>

        {/* One block per shape the SDK offers the function in, each with the arguments
            that shape takes. There is usually exactly one — TypeScript spells an optional
            argument with `?` — but a language that has to spell it as an overload pair
            carries two, and showing only the first would tell a reader half of what a
            program may write.

            Wrapped: a signature is one logical line, so folding it costs nothing and
            scrolling it sideways would hide the return type. */}
        <Section
          label={fn.signatures.length > 1 ? "Signatures" : "Signature"}
        >
          <div className={styles.typeList}>
            {fn.signatures.map((entry) => (
              <div key={entry.signature} className={styles.typeList}>
                <pre className={`${styles.code} ${styles.codeWrap}`}>
                  {entry.signature}
                </pre>
                <ApiParameterList parameters={entry.parameters} />
              </div>
            ))}
          </div>
        </Section>
        <Verbatim label="Documentation" text={fn.doc} />

        {fn.types.length > 0 && (
          <Section label="Types">
            <p className={styles.note}>
              The declarations this signature refers to, transitively closed —
              exactly what a{" "}
              <code>
                view.openDocsView(&quot;{fn.object}.{fn.name}&quot;)
              </code>{" "}
              lookup appends to a session that has not already been shown them.
            </p>
            <div className={styles.typeList}>
              {fn.types.map((type) => (
                // Folded when the declaration is one line, scrolled when it is several —
                // the same rule the signature above is wrapped under, decided per
                // declaration rather than for the list. A one-line `type` alias has no
                // indentation to destroy and some run past 2000px, which is three screens
                // of sideways scrolling to read a single line; a multi-line `interface`
                // has indentation that *is* its structure and must not be reflowed.
                //
                // Today the guest SDK emits only the first shape, so this always folds in
                // practice. The branch is still the rule rather than a `wrap` on the
                // block, because the day one declaration arrives with a body is not a day
                // anyone will remember this line exists.
                <div key={type.name} className={styles.typeList}>
                  <pre
                    className={
                      type.declaration.includes("\n")
                        ? styles.code
                        : `${styles.code} ${styles.codeWrap}`
                    }
                  >
                    {type.declaration}
                  </pre>
                  {/* What the shape MEANS, which the declaration cannot say. A
                      `shown: boolean` on a `FileRead` is not a thing a reader can infer
                      from its name, and neither is a model. */}
                  <p className={styles.note}>{type.doc}</p>
                  {type.members.length > 0 && (
                    <ul className={styles.params}>
                      {type.members.map((member, index) => (
                        <li
                          key={`${member.name}-${index}`}
                          className={styles.param}
                        >
                          <span className={styles.paramHead}>
                            <span className={styles.paramName}>
                              {member.name}
                            </span>
                            {member.type && (
                              <span className={styles.paramType}>
                                {member.type}
                              </span>
                            )}
                          </span>
                          <p className={styles.paramDesc}>{member.doc}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
