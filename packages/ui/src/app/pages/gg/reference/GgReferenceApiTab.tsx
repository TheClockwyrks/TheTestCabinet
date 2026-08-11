import { useMemo } from "react";
import type {
  GgApiFunction,
  GgReference,
  GgReferenceCategory,
  GgReferenceModule,
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
// capability module it lives in.
//
// Grouped by module because that is what the surface *is*: a program writes
// `gg.files.readFile`, the system prompt names the modules and no function at all, and a
// documentation search filters by module. The order is the modules' own — the sequence a
// model is presented with them in — and each folder carries the line the module's own
// declaration introduces it by, since which of twelve modules you want is a question the
// paths alone do not answer.
//
// The join between a folder and its functions is gg's module **id**, never the path: the
// path is one arm's spelling (`gg.files` here, `gg::files` in the Rust arm) and grouping by
// it would silently empty every folder the day the projected language changed.
//
// The whole tab is the same material a program gets back from `openDocsView(...)`,
// reflected out of the guest SDK's own declarations — so what is read here and what
// a model can look up for itself mid-session cannot disagree.
//
// This is the tab's *body*, not a page: the frame around it — the header, the tab bar and
// the fetch both tabs read from — is `GgReferencePage`'s, and lives above the two so
// switching tabs does not throw the document away. See `GgReferencePage.tsx`.

/** One module's folder in the sidebar: the module, the family it came from, its functions. */
interface ModuleGroup {
  module: GgReferenceModule;
  category: GgReferenceCategory | null;
  functions: GgApiFunction[];
}

/**
 * How a function is addressed, in the URL and in the tree: the fully-qualified name the arm
 * advertises it under (`gg.files.readFile`) — which is exactly what a model passes to
 * `openDocsView`, so a link to this page and a lookup a program makes name the same thing.
 *
 * The fallback is for an arm whose catalogue emits no qualified name: `module.name` is then all
 * the identity there is, and it is still unique, since a module cannot declare one name twice.
 */
function functionId(fn: GgApiFunction): string {
  return fn.fqn || `${fn.module}.${fn.name}`;
}

export function GgReferenceApiTab({ reference }: { reference: GgReference }) {
  const folders = useFsFolders();
  const { requested, select } = useEntrySelection("fn");

  // Modules in the order the payload presents them, which is the order a model meets them
  // in its own system prompt. A module with no functions is dropped rather than shown
  // empty: every arm carries one for the type declarations that belong to no capability,
  // and a folder with nothing in it would read as a module offering nothing to call.
  const groups = useMemo<ModuleGroup[]>(
    () =>
      reference.modules
        .map((module) => ({
          module,
          category:
            reference.categories.find(
              (category) => category.id === module.category,
            ) ?? null,
          functions: reference.functions.filter(
            (fn) => fn.module === module.id,
          ),
        }))
        .filter((group) => group.functions.length > 0),
    [reference],
  );

  // With no `?fn=`, the pane opens on the first row of the **tree** — not on
  // `reference.functions[0]`. The payload is in catalogue order, which begins with the
  // *ending* call (the last module), so the first entry of the array sits ten folders
  // down a sidebar that scrolls: the pane would open on something the reader cannot see
  // is selected, and the tree would look as though nothing were. Walking the groups is
  // the same walk the sidebar below does, so the highlight is always its first row.
  const selected =
    requested == null
      ? (groups[0]?.functions[0] ?? null)
      : (reference.functions.find((fn) => functionId(fn) === requested) ??
        null);

  // Twelve folders of functions scroll well past the fold, so a link to a session call
  // would otherwise open beside a tree still showing the filesystem module.
  useRevealSelection(requested != null, selected != null);

  return (
    <FsExplorer
      sidebarLabel="API modules"
      tree={groups.map((group) => (
        <FsFolder
          key={group.module.id}
          depth={0}
          // Open by default, like the Tools tree: this is a fixed document read by
          // scanning, not a live stream that needs collapsing.
          open={folders.isOpen(group.module.id, true)}
          onToggle={() => folders.toggle(group.module.id, true)}
          ariaLabel={`${group.module.path} functions`}
          name={group.module.path}
          meta={<span className={panels.fsMeta}>{group.functions.length}</span>}
        >
          {/* The module's own line, as the folder's first child rather than as a second
              line in its row — see `.objectCaption`. `fsIndent(1)` is the same inline
              indent the function rows below take, which is what puts it in their column
              instead of against the sidebar's edge.

              The module's summary rather than its family's description: the family is a
              grouping of gg's, and what a reader picking a folder wants is the sentence
              the module itself is introduced by — the same one the model is given. */}
          <li className={styles.objectCaption} style={fsIndent(1)}>
            {group.module.summary}
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
          module={
            reference.modules.find((module) => module.id === selected.module) ??
            null
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
  module,
}: {
  fn: GgApiFunction;
  /** The function's family, or `null` if the payload names one it does not carry. */
  category: GgReferenceCategory | null;
  /** The module it lives in, or `null` if the payload names one it does not carry. */
  module: GgReferenceModule | null;
}) {
  return (
    <div className={panels.panelBody}>
      <div className={styles.detail}>
        <header className={styles.detailHead}>
          <h2 className={styles.detailTitle}>{functionId(fn)}</h2>
          <div className={styles.meta}>
            <span className={styles.chip}>
              {category?.title ?? fn.category}
            </span>
            {/* gg's own name for what this call DOES, which is the one thing about it that
                is the same in all eleven language arms — and the string a run's records
                name it by, so a reader who has this page open and a run's calls in front
                of them is looking at the same identifier in both. */}
            {fn.operation && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                {fn.operation}
              </span>
            )}
            {/* The line a program writes to reach the module, where the arm needs one.
                Ten of eleven arms put the SDK in scope already and carry none. */}
            {module?.import && (
              <span className={styles.chip}>{module.import}</span>
            )}
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
            {/* Any other capability that buys the call, named. `library` answers for
                exactly one of them, so a call bought by a second — `docview-close` is
                the first — would otherwise show nothing at all here. */}
            {fn.capability && !fn.library && (
              <span className={`${styles.chip} ${styles.chipKey}`}>
                bought by {fn.capability}
              </span>
            )}
            {/* Nothing gates a view function: every program gets them whatever a run
                enables, and saying so is more useful than an empty metadata row. This is
                an affirmative claim, so it is guarded on every field that can withhold a
                call — a tool, a role, and a capability. An unrecognised gate must leave
                the row empty rather than let this assert availability it cannot check. */}
            {!fn.gate && !fn.ending && !fn.library && !fn.capability && (
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
        <Section label={fn.signatures.length > 1 ? "Signatures" : "Signature"}>
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
              Every declaration this signature reaches, <em>transitively
              closed</em> — which is more than any one lookup appends. A{" "}
              <code>openDocsView(&quot;{functionId(fn)}&quot;)</code> mid-session
              goes exactly <em>one</em> level deep and opens only what that
              agent&rsquo;s documentation mode selects: the return position under{" "}
              <code>return</code> (the default), everything the signature names
              under <code>return-and-parameters</code>, nothing under{" "}
              <code>off</code> — and nothing it has already been shown.
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
