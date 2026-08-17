// Emit the signature catalogue gg documents this arm's surface from.
//
// gg has to be able to tell a model what a function it found does, and every word of that answer is
// REFLECTED out of the SDK's own emitted declarations rather than written in a prompt template. In a
// `.d.ts` the declaration *is* the signature and the JSDoc beside it is already written for the
// audience that will read it, so the two cannot drift; a hand-written list would drift silently, and
// a model shown a signature the sandbox does not have wastes a whole turn discovering it.
//
// The pipeline, both halves of which `packages/gg-sandbox/signatures.sh` runs in order:
//
//   src/gg/*.ts  --tsc-->  dist/headers/gg/*.d.ts
//                --this script-->  $GG_SIGNATURES_OUT_DIR/<language-id>.signatures.json
//
// and `crates/gg/src/sandbox/language/{typescript,javascript}.rs` embed that JSON with
// `include_str!` out of their own build's `OUT_DIR`. `crates/gg/build.rs` is what runs the script,
// through `scripts/gg-signatures.sh`, so the catalogue is reflected on the same build that compiles
// the host reading it: the documentation cannot describe a declaration this checkout does not have,
// because there is no copy of it old enough to.
//
// It emits TWO catalogues from one set of declarations, because gg's TypeScript and JavaScript arms
// ARE one set of declarations: the same guest, the same SDK, the same signatures, and one difference
// — whether gg type-checks the program before evaluating it. See `LANGUAGES` below.
//
// # What the shape is
//
// The normalized doc model: **modules** rather than API objects, one flat **functions** array
// whose entries name a gg **operation** and are keyed by a module-qualified **fqn**, an **authored**
// brief and optional detail rather than a derived summary, and type references **resolved** to the
// declaration each one opens.
//
//   * a module is `src/gg/<id>.ts`, and its own file-leading JSDoc is what introduces it;
//   * a function is an exported function of one of those files, and the gg operation it binds is
//     written ON the declaration as `@ggop <namespace>.<key>` — never in a table beside it, because a
//     table is a second place to be wrong;
//   * a type is an exported interface, type alias or class of one of those files, and it belongs to
//     the module that declares it, so two modules are free to declare a type of one name;
//   * a HELPER is a method signature on one of those interfaces, naming the operation it is a
//     shorter way to reach: `handle.send(text)` for `gg.delegation.sendMessage(handle.id, text)`.
//     It is catalogued as an ALIAS of that operation — gated identically, counting toward no
//     capability of its own — and both as an entry of its own and as a line on its type;
//   * the fully-qualified name is `gg.<module>.<name>`, which is a path a program can really write:
//     the shim binds `gg` with one object per module this run offers.
//
// # What is enforced here rather than left to review
//
// Everything below is the same rule under a different subject: NOTHING a model reads about this SDK
// may be written anywhere but on the declaration it describes, and a declaration that has not said it
// is a build error rather than a blank in a documentation view.
//
//   * every exported function of a module names a gg operation, and every operation gg's binding
//     tables list is bound by exactly one function — the failure this catches in both directions is a
//     capability quietly missing from a model's whole surface;
//   * an operation's key names its function: `files.read_file` is `readFile` and nothing else, which
//     is what lets the shim bind by derivation instead of by a second table;
//   * a doc comment's FIRST LINE is the brief and everything after the blank line that follows it is
//     the detail, so an opening paragraph that wraps onto a second line is refused AT THE DECLARATION
//     rather than several steps later in a gate over the emitted JSON;
//   * every PARAMETER carries an `@param`, every field of an inline object argument carries an
//     `@param a.b`, and an `@param` naming something the signature does not declare is an error too,
//     so a renamed parameter cannot leave its description behind under the old name;
//   * every call that RETURNS something carries an `@returns` saying what that something is, and one
//     that returns `void` carries none — the type in the signature says what shape a value has and
//     nothing about what it holds, while "returns nothing" is a line that displaces the brief
//     without replacing it;
//   * a `@throws` opens by naming `ToolError`, so the one sentence that tells a model what a `catch`
//     will hold cannot render as a verb with no subject;
//   * every TYPE and every one of its members is documented, and a type nothing refers to is refused,
//     because a declaration nothing reaches is a documentation view nothing can open;
//   * no two types share a name, since the bare name is a key a model may reasonably type.
//
// # One entry, many signatures
//
// A function's entry carries a `signatures` ARRAY rather than one string, because how a language
// offers an optional argument is that language's own business: Java writes two overloads where Kotlin
// writes one signature with a default and Python writes one with a keyword argument. TypeScript
// spells every optional argument with `?`, so every entry here has exactly one signature today. The
// overload group is still read, not assumed away.
//
// Usage:
//   GG_SIGNATURES_OUT_DIR=<dir> node tools/signatures.mjs   # write one catalogue per language
//
// The destination comes from the environment and has no default, because there is no longer one
// obvious place: the catalogues are generated into a build directory by `crates/gg/build.rs` and
// into whatever a developer names when they want to read one. There is likewise no "check whether
// the committed copies are current" mode, because there are no committed copies — a JSDoc edited
// without a regeneration is not a state this repository can be in, since the next build of gg
// reflects it.
//
// Run `packages/gg-sandbox/signatures.sh` rather than this file directly: it emits the declarations
// this reads, and it is the entry `scripts/gg-signatures.sh` and the npm `signatures` script both go
// through.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The TypeScript compiler API is the package's one devDependency, hoisted to the repo root by npm's
// workspaces; `createRequire` resolves it the same way `tsc` itself is resolved.
const require = createRequire(import.meta.url);
/** @type {import("typescript")} */
const ts = require("typescript");

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(PACKAGE_DIR, "src");
const HEADERS_DIR = path.join(PACKAGE_DIR, "dist", "headers", "gg");

/**
 * The gg program languages this guest implements: each one's `GgProgramLanguage` id, which is also
 * the stem each emitted catalogue is filed under.
 *
 * The id is written into the catalogue so the emitted file says whose spellings it carries, and is
 * asserted by the host against the language that embedded it — a catalogue filed under the wrong
 * stem is then a load-time failure rather than documentation describing a sandbox nobody has. That
 * assertion earns more now than it did, not less: a build that generates eleven catalogues into one
 * directory is exactly the arrangement in which the wrong one could be wired to an arm.
 *
 * There are TWO of them for one set of declarations, and that is the whole shape of gg's JavaScript
 * arm. `javascript` is `typescript` with the type check removed: the same component, the same SDK,
 * the same signatures — type annotations included, so a model on either arm reads exactly the same
 * surface — and the only difference is that gg does not run `tsc` over the program before evaluating
 * it. Emitting the catalogue twice under two ids is what lets the host embed one per language and
 * assert each is its own, without a hand-copied second file that could drift from the declarations it
 * was reflected out of.
 */
const LANGUAGES = ["typescript", "javascript"];

/**
 * The line a program on either ECMAScript arm writes to reach gg's SDK.
 *
 * One line for the whole surface, and the namespace form: it is what makes `gg.files.readFile` — the
 * name every documentation view is filed under and every quoted call is written with — an expression
 * the program can write.
 */
const SURFACE_IMPORT = 'import * as gg from "gg";';

/** The doc model this catalogue is written in. See the header. */
const SCHEMA = 1;

/**
 * The provenance string written into the catalogue, so a reader of the JSON knows it is generated and
 * where from.
 */
const GENERATED_FROM = "packages/gg-sandbox/src/gg/ (tsc, declaration emit)";

/**
 * The longest a brief may be, in characters.
 *
 * The same cap `crates/gg/src/sandbox/language/register.rs` holds every arm's catalogue to, and it is
 * enforced here as well because the host's copy is a `#[test]`: a reflection that embedded a
 * paragraph in the brief field would succeed, and so would a build, and the author would hear about
 * it from a gate three steps away naming an entry they then have to go looking for. Here is where the
 * author is standing.
 */
const BRIEF_CAP = 120;

/** The JSDoc tag that names the gg operation a declaration binds. */
const OPERATION_TAG = "ggop";

/** The JSDoc tag that marks a declaration as this package's business rather than a model's. */
const INTERNAL_TAG = "internal";

/** The JSDoc tag that says what a call hands back. Rendered under {@link RETURNS_LEAD}. */
const RETURNS_TAG = "returns";

/** The JSDoc tag that says how a call fails. Rendered under {@link THROWS_LEAD}. */
const THROWS_TAG = "throws";

/**
 * The word a `@returns` is rendered under, and the colon that introduces the noun phrase after it.
 *
 * JSDoc's own tag supplies the word, exactly as `@param` supplies the parameter list's: the tag is
 * `@returns`, so the section is `Returns:`. Nothing here invents or renames a word — an arm whose
 * documentation dialect says one thing and whose catalogue says another is the defect this
 * arrangement exists to make impossible.
 */
const RETURNS_LEAD = "Returns:";

/**
 * The word a `@throws` is rendered under.
 *
 * No colon, because the sentence continues grammatically: the tag carries `` `ToolError` with
 * `not-found` for a missing path ``, and the rendered line reads *Throws `ToolError` with
 * `not-found` for a missing path.* That inline lead-in is this arm's own form and JavaScript's own
 * verb — a program `throw`s, a `catch` catches — and it is what the prose said before it moved onto
 * a tag.
 */
const THROWS_LEAD = "Throws";

/** The return type of a declaration that hands nothing back, and so documents no return. */
const NO_RETURN = "void";

/**
 * The type every signature reaches whether it names it or not.
 *
 * Every function on this surface throws it, and no signature says so, because TypeScript has no
 * checked exceptions. Folding it into each entry's closure is what makes a documentation view of any
 * call carry the type its failure arrives as.
 */
const ALWAYS_REFERENCED = "ToolError";

/**
 * What a `@throws` must open with, so that every failure sentence names the type it arrives as.
 *
 * TypeScript has no checked exceptions, so the *only* place a model learns what a `catch` will hold
 * is this sentence. Requiring the opening keeps `Throws` from ever rendering as a bare verb with no
 * subject.
 */
const THROWS_SUBJECT = `\`${ALWAYS_REFERENCED}\``;

/**
 * Print a node without its comments and on one line.
 *
 * The printer is used rather than the raw source text because a declaration's members carry JSDoc
 * written for a developer reading the source, while this output is read by a model — the declaration
 * has to arrive as a declaration, not as a paragraph.
 */
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** @param {import("typescript").Node} node @param {import("typescript").SourceFile} sourceFile */
function print(node, sourceFile) {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, " ").trim();
}

/** The declaration text as a documentation view shows it: no `export`/`declare`, no trailing `;`. */
function declarationText(node, sourceFile) {
  return print(node, sourceFile)
    .replace(/^(?:export\s+)?(?:declare\s+)?/, "")
    .replace(/;$/, "");
}

// --- Documentation -------------------------------------------------------------------------------

/** One paragraph of prose on one line, because what this feeds renders as markdown. */
function flatten(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A block of prose with its paragraphs flattened and its fenced examples kept verbatim.
 *
 * A doc comment wraps at whatever width its author writes to, and those line breaks are an artifact
 * of the source file rather than anything a reader of the rendered documentation should see. A fenced
 * block is the exception: its line breaks are the code.
 */
function reflow(text) {
  const out = [];
  let paragraph = [];
  let fenced = false;
  const close = () => {
    if (paragraph.length > 0) {
      out.push(flatten(paragraph.join(" ")));
      paragraph = [];
    }
  };
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      close();
      if (fenced) {
        out[out.length - 1] = `${out[out.length - 1]}\n${line.trim()}`;
        fenced = false;
      } else {
        out.push(line.trim());
        fenced = true;
      }
      continue;
    }
    if (fenced) {
      out[out.length - 1] = `${out[out.length - 1]}\n${line}`;
      continue;
    }
    if (line.trim() !== "") paragraph.push(line.trim());
    else close();
  }
  close();
  return out.join("\n\n");
}

/**
 * Split one doc comment into its brief and its detail, or fail naming the declaration.
 *
 * The rule is the model's: a summary line, then a blank line, then the rest, and that line no longer
 * than {@link BRIEF_CAP}. Both halves are enforced here rather than in a gate over the emitted JSON
 * because here is where the author is standing — a first paragraph that wraps over two lines, or a
 * summary line that runs on for a paragraph's worth of characters, is a mistake to be told about at
 * the declaration, not three steps later under a name the author has to go looking for.
 */
function proseOf(text, where) {
  if (!text || text.trim() === "") {
    throw new Error(
      `${where} has no doc comment. Every catalogued declaration's documentation is shown to a ` +
        "model, so an undocumented one would reach it as a bare signature.",
    );
  }
  const lines = text.replace(/\r/g, "").replace(/^\n+/, "").split("\n");
  const brief = (lines[0] ?? "").trim();
  if (brief === "") {
    throw new Error(`${where}'s doc comment opens with a blank line rather than with a brief.`);
  }
  const rest = lines.slice(1);
  if (rest.length > 0 && rest[0].trim() !== "") {
    throw new Error(
      `${where}'s brief runs over more than one line. The first line of a doc comment is the brief ` +
        "and everything after the blank line that follows it is the detail, so a first paragraph " +
        `that wraps has no brief in it: ${JSON.stringify(brief)}`,
    );
  }
  if (brief.length > BRIEF_CAP) {
    throw new Error(
      `${where} has a ${brief.length}-character brief, and a brief is capped at ` +
        `${BRIEF_CAP}: ${JSON.stringify(brief)}`,
    );
  }
  const detail = reflow(rest.join("\n"));
  return { brief, detail: detail === "" ? null : detail };
}

/** The JSDoc blocks attached to `node`, excluding the file's own leading block. */
function blocks(node, sourceFile) {
  return ts
    .getJSDocCommentsAndTags(node)
    .filter((block) => ts.isJSDoc(block) && sourceFile.text.slice(0, block.pos).trim() !== "");
}

/**
 * The JSDoc block that belongs to `node`, which is the last one attached to it.
 *
 * The *file's* leading block is the module header, and declaration emit attaches it to whatever
 * declaration follows once the type-only imports that stood between them are elided. It is excluded
 * explicitly, because otherwise a declaration whose doc was deleted would silently inherit its
 * module's description and reach a model as a paragraph about the wrong thing.
 */
function ownBlock(node, sourceFile) {
  return blocks(node, sourceFile).at(-1);
}

/** One declaration's own documentation, split into a brief and a detail. */
function documentation(node, sourceFile, where) {
  const own = ownBlock(node, sourceFile);
  return proseOf(own ? (ts.getTextOfJSDocComment(own.comment) ?? "") : "", where);
}

/**
 * The text of every JSDoc tag called `name` on `node`'s **own** block, in the order they were
 * written.
 *
 * The own block rather than every block attached, because the block the compiler also hands back is
 * the file's module header ({@link ownBlock}) — and a `@throws` written on a module header is a
 * sentence about the module, not about the declaration that happens to follow it.
 */
function ownTags(node, sourceFile, name) {
  const out = [];
  for (const tag of ownBlock(node, sourceFile)?.tags ?? []) {
    if (tag.tagName.getText(sourceFile) !== name) continue;
    out.push(flatten(ts.getTextOfJSDocComment(tag.comment) ?? ""));
  }
  return out;
}

/**
 * The **structured** half of one call's documentation: what it hands back, and how it fails.
 *
 * # Why these are tags and the rest is prose
 *
 * Because their *order* is a fact about the page rather than about the sentence. A model reads a
 * call's description, then what it gets, then what can go wrong — and leaving that sequence to
 * whoever last edited the paragraph is how an arm ends up telling a model how a call fails before
 * telling it what the call produces. On a tag, the sequence is decided here, once.
 *
 * It is also what makes the two properties **countable**. Failure documentation and return
 * documentation are the two things a model most needs and the two an author most easily forgets,
 * and a prose paragraph cannot be counted: nothing distinguishes a sentence that happens to open
 * with *Throws* from one that does not. A tag can be counted, and a missing one can be refused —
 * which is what the return rule below does.
 *
 * # The return rule, in both directions
 *
 * A call that hands something back **must** say what, for the same reason every parameter must
 * carry an `@param`: the type in the signature says what shape the value has and nothing at all
 * about what it *is*, and a model that has to guess opens a documentation view for nothing. A call
 * that hands nothing back must **not** — "returns nothing" is a sentence that displaces the brief
 * without replacing it, and the brief already said what the call did.
 *
 * There is deliberately no matching rule for `@throws`. Most of this surface can fail and says so,
 * but `gg.views.current` reads gg's own live view set behind a binding no run withholds, so it has
 * no failure to describe — and a rule that made it invent one would be a rule for producing
 * sentences rather than for producing documentation.
 */
function sections(node, sourceFile, where, returnType) {
  const out = [];
  const returns = ownTags(node, sourceFile, RETURNS_TAG);
  if (returns.length > 1) {
    throw new Error(
      `${where} carries ${returns.length} \`@${RETURNS_TAG}\` tags, and it returns once.`,
    );
  }
  const [returned] = returns;
  if (returnType === NO_RETURN) {
    if (returned !== undefined) {
      throw new Error(
        `${where} returns \`${NO_RETURN}\` and documents a return with \`@${RETURNS_TAG}\`. ` +
          "Saying that nothing comes back displaces the brief with a line that adds nothing to it.",
      );
    }
  } else if (returned === undefined || returned === "") {
    throw new Error(
      `${where} returns \`${returnType}\` and does not say what that is. Write ` +
        `\`@${RETURNS_TAG} <what comes back>\`: the type says what shape the value has and nothing ` +
        "about what it holds.",
    );
  } else {
    out.push(`${RETURNS_LEAD} ${returned}`);
  }
  for (const thrown of ownTags(node, sourceFile, THROWS_TAG)) {
    if (!thrown.startsWith(THROWS_SUBJECT)) {
      throw new Error(
        `${where}'s \`@${THROWS_TAG}\` does not open with ${THROWS_SUBJECT}, so the rendered ` +
          `sentence would say what happens without naming what a \`catch\` holds: ` +
          `${JSON.stringify(thrown)}`,
      );
    }
    out.push(`${THROWS_LEAD} ${thrown}`);
  }
  return out;
}

/**
 * One call's whole documentation: its authored prose, then its {@link sections}.
 *
 * The brief and the detailed description are read exactly as every other declaration's are; the
 * structured sections are appended to the detail, so a call with nothing more to say than its brief
 * and its return still has a detail, and one with neither still has none.
 */
function callProse(node, sourceFile, where, returnType) {
  const prose = documentation(node, sourceFile, where);
  const extra = sections(node, sourceFile, where, returnType);
  if (extra.length === 0) return prose;
  const detail = [prose.detail, ...extra].filter((part) => part).join("\n\n");
  return { brief: prose.brief, detail };
}

/** The text of one JSDoc tag on `node`, or `undefined` when it carries none. */
function tagText(node, sourceFile, name) {
  for (const block of blocks(node, sourceFile)) {
    for (const tag of block.tags ?? []) {
      if (tag.tagName.getText(sourceFile) !== name) continue;
      return flatten(ts.getTextOfJSDocComment(tag.comment) ?? "");
    }
  }
  return undefined;
}

/** Whether `node` is marked as this package's business rather than a model's. */
function internal(node, sourceFile) {
  return tagText(node, sourceFile, INTERNAL_TAG) !== undefined;
}

/**
 * The `@param` descriptions on a declaration, keyed by the name each one addresses.
 *
 * A field of an inline object argument is addressed the way JSDoc addresses one — `@param
 * options.offset` — so the key is the dotted path. That is deliberately the only way to document a
 * field: a parameter whose type is a NAMED type is documented on that type's members instead, so the
 * same sentence can never be written in two places.
 */
function paramDocs(node, sourceFile) {
  const own = ownBlock(node, sourceFile);
  const docs = new Map();
  for (const tag of own?.tags ?? []) {
    if (!ts.isJSDocParameterTag(tag)) continue;
    docs.set(tag.name.getText(sourceFile), flatten(ts.getTextOfJSDocComment(tag.comment) ?? ""));
  }
  return docs;
}

/**
 * The doc comment written above one arm of a union, read from the source text rather than the AST.
 *
 * A union arm is the one documented thing in a `.d.ts` that `getJSDocCommentsAndTags` cannot answer
 * for: the block sits before the `|` that introduces the arm, so it falls outside the arm node and is
 * attached to nothing. Scanning forward from where the previous arm ended is what finds it, and only
 * a `/**` block counts — a `//` note left after an arm is a note, not the next arm's description.
 */
function armDoc(union, index, sourceFile) {
  const from = index === 0 ? union.pos : union.types[index - 1].end;
  const block = (ts.getLeadingCommentRanges(sourceFile.text, from) ?? [])
    .map((range) => sourceFile.text.slice(range.pos, range.end))
    .filter((text) => text.startsWith("/**"))
    .at(-1);
  if (!block) return "";
  return block
    .slice(3, -2)
    .split("\n")
    .map((line) => line.replace(/^\s*\*/, "").replace(/^ /, "").trimEnd())
    .join("\n")
    .trim();
}

// --- The source tree -----------------------------------------------------------------------------

/**
 * The tables that decide a program's surface, read from `src/catalogue.ts`.
 *
 * The source file is transpiled in memory and imported as a data URL rather than read out of `dist/`,
 * so this script depends only on what `tsconfig.headers.json` emits — which is what lets a build of
 * gg reflect this arm's catalogues without ever building the JavaScript the component is made from,
 * and therefore without `componentize-js` on the machine doing the building.
 */
async function loadCatalogue() {
  const file = path.join(SRC_DIR, "catalogue.ts");
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputText, "utf8").toString("base64")}`;
  return import(url);
}

/** One emitted module header, parsed. */
async function loadModule(id) {
  const file = path.join(HEADERS_DIR, `${id}.d.ts`);
  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(
      `no declarations at ${file} — run \`tsc -p tsconfig.headers.json\` first (the \`signatures\` ` +
        "npm script does).",
    );
  });
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /* setParentNodes */ true);
}

/** Whether a statement is exported, which is the whole of what makes a declaration model-facing. */
function exported(statement) {
  return (statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** The module's own header documentation: the file's leading JSDoc block. */
function moduleProse(sourceFile, where) {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(sourceFile.text);
  if (!match) throw new Error(`${where} has no module header, and the header is what introduces it.`);
  const text = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*/, "").replace(/^ /, "").trimEnd())
    .join("\n")
    .trim();
  return proseOf(text, where);
}

// --- Types ---------------------------------------------------------------------------------------

/**
 * The members of one type declaration, each with the documentation written on it.
 *
 * Three shapes reach a model and all three are walked. A record's members are its properties. A union
 * of string literals — `TaskStatus`, `AgentEnding` — has one member per arm, named by the literal
 * itself and carrying no type of its own, because the arm *is* the value. A union of records
 * contributes every arm's properties in order.
 */
function typeMembers(statement, sourceFile, where) {
  if (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return propertyMembers(statement.members, sourceFile, where);
  }
  return ts.isTypeAliasDeclaration(statement)
    ? typeNodeMembers(statement.type, sourceFile, where)
    : [];
}

/** {@link typeMembers}, for one type *node* — the recursive half. */
function typeNodeMembers(node, sourceFile, where) {
  if (ts.isParenthesizedTypeNode(node)) return typeNodeMembers(node.type, sourceFile, where);
  if (ts.isTypeLiteralNode(node)) return propertyMembers(node.members, sourceFile, where);
  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((arm, index) => {
      if (!ts.isLiteralTypeNode(arm)) return typeNodeMembers(arm, sourceFile, where);
      const name = print(arm, sourceFile);
      const prose = proseOf(armDoc(node, index, sourceFile), `${where}.${name}`);
      return [{ name, type: null, kind: "variant", brief: prose.brief, detail: prose.detail }];
    });
  }
  return [];
}

/** The named, typed members of a member list — properties, and nothing a program cannot read. */
function propertyMembers(members, sourceFile, where) {
  return members
    .filter((m) => (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m)) && m.name)
    .map((member) => {
      const name = member.name.getText(sourceFile);
      const prose = documentation(member, sourceFile, `${where}.${name}`);
      return {
        name,
        type: member.type ? print(member.type, sourceFile) : null,
        kind: "field",
        brief: prose.brief,
        detail: prose.detail,
      };
    });
}

/**
 * The **method signatures** of one declared type — the convenience helpers a value carries.
 *
 * # Why a value carries a method at all
 *
 * Because the id it would otherwise be asked for is already in the caller's hand. `spawnSubagent`
 * hands back a `SubagentHandle` whose `id` is exactly what `sendMessage` takes, and a program that
 * writes `gg.delegation.sendMessage(handle.id, text)` has restated a fact it was just given. The
 * method is the same operation reached the short way — an **alias**, gated identically, counting
 * toward no capability of its own — and it is written on an `interface` rather than a `class`
 * because nothing in a program ever constructs one of these: they arrive from a call, and a
 * declaration carrying a constructor a model may not use would be a declaration inviting it to.
 *
 * A method's own `@ggop` names the operation it is a second way to reach. That is what makes it an
 * alias rather than a rival binding, and it is checked against gg's vocabulary in {@link build}
 * exactly as a module function's is.
 */
function methodMembers(statement, sourceFile) {
  if (!ts.isInterfaceDeclaration(statement)) return [];
  return statement.members.filter(
    (member) => ts.isMethodSignature(member) && member.name && !internal(member, sourceFile),
  );
}

/**
 * Every declared type, and the closure over what a piece of declaration text refers to.
 *
 * The closure is transitive, because a signature that names a type whose own declaration names a
 * second one leaves a dangling reference in front of the model: `searchArchive` returns an
 * `ArchiveSearch`, whose declaration is only useful alongside `ArchiveHit`.
 *
 * A reference is recorded as the pair `{ spelled, fqn }` — what the signature writes, and the key a
 * documentation view is opened by. On this arm the spelling is the bare name, because that is what a
 * signature really writes and what the shim binds `ToolError` under; the fqn is
 * `gg.<module>.<name>`, which is where the declaration is filed.
 */
class Resolver {
  constructor(declared) {
    /** @type {Map<string, { fqn: string, declaration: string }>} */
    this.byName = new Map();
    for (const type of declared) {
      if (this.byName.has(type.name)) {
        throw new Error(
          `two modules declare a type called \`${type.name}\`; the bare name is a key a model may ` +
            "reasonably type, so it has to name one declaration.",
        );
      }
      this.byName.set(type.name, { fqn: type.fqn, declaration: type.declaration });
    }
  }

  /** The names `text` refers to directly, in declaration order. */
  direct(text) {
    return [...this.byName.keys()]
      .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
      .map((name) => ({ spelled: name, fqn: this.byName.get(name).fqn }));
  }

  /** The transitive closure of what every one of `written` refers to, in declaration order. */
  closure(...written) {
    const seen = new Set();
    const walk = (text) => {
      for (const [name, type] of this.byName) {
        if (seen.has(name)) continue;
        if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
        seen.add(name);
        walk(type.declaration);
      }
    };
    for (const text of written) walk(text);
    return [...this.byName.keys()]
      .filter((name) => seen.has(name))
      .map((name) => ({ spelled: name, fqn: this.byName.get(name).fqn }));
  }
}

// --- Signatures ----------------------------------------------------------------------------------

/** One declaration's parameters, each with the `@param` written for it. */
function parametersOf(node, sourceFile, where) {
  const docs = paramDocs(node, sourceFile);
  const addressed = new Set();
  const parameters = node.parameters.map((parameter) => {
    const name = parameter.name.getText(sourceFile);
    addressed.add(name);
    const fields = inlineFields(parameter.type, sourceFile).map((field) => {
      const address = `${name}.${field.name}`;
      addressed.add(address);
      return {
        ...field,
        kind: "positional",
        default: null,
        doc: required(docs.get(address), where, `the field \`${address}\``, `@param ${address}`),
        fields: [],
      };
    });
    return {
      name,
      type: parameter.type ? print(parameter.type, sourceFile) : "unknown",
      optional: Boolean(parameter.questionToken || parameter.initializer),
      kind: "positional",
      default: parameter.initializer ? print(parameter.initializer, sourceFile) : null,
      doc: required(docs.get(name), where, `the parameter \`${name}\``, `@param ${name}`),
      fields,
    };
  });
  for (const address of docs.keys()) {
    if (!addressed.has(address)) {
      throw new Error(
        `${where} documents \`${address}\` with an \`@param\`, and its signature declares no such ` +
          "parameter or inline field. A description left behind under an old name is a description " +
          "no model will ever be shown.",
      );
    }
  }
  return parameters;
}

/** The text of a required doc comment, or a build error naming exactly what to write and where. */
function required(text, subject, what, how) {
  if (text) return text;
  throw new Error(
    `${subject}: ${what} has no documentation. Everything a model reads about this SDK is ` +
      `reflected from the declaration it describes, so write \`${how}\` rather than leaving a model ` +
      "to guess.",
  );
}

/**
 * The fields of a parameter whose type is written INLINE, and nothing else.
 *
 * A parameter typed by name — `memory: MemoryWrite` — has no fields here on purpose: that type is
 * catalogued in its own right and its members carry its documentation, so documenting the fields at
 * the call site as well would be two copies of one sentence with nothing keeping them equal.
 *
 * Unions and intersections are walked because a brief that is `{ agent } & ({ prompt } | { issueId })`
 * is still one object a model fills in, and the fields it may fill in are all of them.
 */
function inlineFields(node, sourceFile) {
  if (!node) return [];
  if (ts.isParenthesizedTypeNode(node)) return inlineFields(node.type, sourceFile);
  if (ts.isTypeLiteralNode(node)) {
    return node.members
      .filter((member) => ts.isPropertySignature(member) && member.name)
      .map((member) => ({
        name: member.name.getText(sourceFile),
        type: member.type ? print(member.type, sourceFile) : "unknown",
        optional: Boolean(member.questionToken),
      }));
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    const out = [];
    const seen = new Set();
    for (const arm of node.types) {
      for (const field of inlineFields(arm, sourceFile)) {
        if (seen.has(field.name)) continue;
        seen.add(field.name);
        out.push(field);
      }
    }
    return out;
  }
  return [];
}

/** One overload group's shapes, each with its own parameters. */
function signaturesOf(nodes, sourceFile, name, where) {
  return nodes.map((node) => {
    const rendered = node.parameters.map((p) => print(p, sourceFile)).join(", ");
    const returnType = node.type ? print(node.type, sourceFile) : "void";
    return {
      signature: `${name}(${rendered}): ${returnType}`,
      parameters: parametersOf(node, sourceFile, where),
    };
  });
}

// --- The catalogue -------------------------------------------------------------------------------

/** Build the whole catalogue, for the language whose id is `language`. */
async function build(language) {
  const catalogue = await loadCatalogue();
  const { MODULE_ORDER, OPERATIONS, SURFACE, exportedName, keyOf, moduleOf } = catalogue;

  // Every operation this SDK says it implements. It is the *other* direction of the `@ggop` check: a
  // declaration that names no operation is caught below, and an operation nothing declares is caught
  // against this set, which is the failure that would otherwise cost a whole capability with nothing
  // to see in a diff.
  const expected = new Set(OPERATIONS);

  const modules = [];
  const declared = [];
  /** @type {{ id: string, name: string, fqn: string, operation: string, nodes: any[], sourceFile: any }[]} */
  const found = [];
  /**
   * The {@link methodMembers} of every declared type, each carrying the declaration it hangs off.
   *
   * Collected beside the module functions rather than inside the type walk, because an alias has to
   * be checked against the **canonical** binding it is an alias of — and that binding may be
   * declared further down the same file.
   *
   * @type {{ id: string, type: any, node: any, sourceFile: any }[]}
   */
  const helpers = [];

  for (const id of MODULE_ORDER) {
    const sourceFile = await loadModule(id);
    const path = `${SURFACE}.${id}`;
    const prose = moduleProse(sourceFile, `the module \`${path}\``);
    modules.push({
      id,
      path,
      brief: prose.brief,
      detail: prose.detail,
      // The one line a program writes to reach every module below. It is the NAMESPACE import
      // rather than a named one, because `path` above is the name every documentation view, every
      // search hit and every call gg quotes is written with — and `import * as gg from "gg";` is
      // what makes that name an expression the program can write. A named import
      // (`import { files } from "gg";`) reaches the same module and is equally valid; it is not what
      // gg teaches, because it would leave every quoted `gg.files.…` one edit away from compiling.
      //
      // One line for both arms: they are one language on one guest, and the loader that resolves
      // this specifier is the same loader.
      import: SURFACE_IMPORT,
    });
    const byName = new Map();
    for (const statement of sourceFile.statements) {
      if (!exported(statement) || internal(statement, sourceFile)) continue;
      const name = statement.name?.text;
      if (!name) continue;
      if (ts.isFunctionDeclaration(statement)) {
        const entry = byName.get(name);
        if (entry) {
          entry.nodes.push(statement);
          continue;
        }
        const where = `\`${path}.${name}\``;
        const operation = tagText(statement, sourceFile, OPERATION_TAG);
        if (!operation) {
          throw new Error(
            `${where} is exported and names no gg operation. Write ` +
              `\`@${OPERATION_TAG} <namespace>.<key>\` on the declaration: an entry gg cannot ` +
              "resolve is dropped from search, from every directory and from every documentation " +
              "view.",
          );
        }
        const record = {
          id,
          name,
          fqn: `${path}.${name}`,
          operation,
          nodes: [statement],
          sourceFile,
        };
        byName.set(name, record);
        found.push(record);
      } else if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)
      ) {
        const fqn = `${path}.${name}`;
        const prose = documentation(statement, sourceFile, `the type \`${fqn}\``);
        const type = {
          module: id,
          name,
          fqn,
          declaration: declarationText(statement, sourceFile),
          brief: prose.brief,
          detail: prose.detail,
          members: typeMembers(statement, sourceFile, fqn),
          memberFunctions: [],
        };
        declared.push(type);
        for (const node of methodMembers(statement, sourceFile)) {
          helpers.push({ id, type, node, sourceFile });
        }
      }
    }
  }

  const resolver = new Resolver(declared);
  const reached = new Set();
  const claimed = new Map();
  const functions = [];

  for (const entry of found) {
    const where = `\`${entry.fqn}\``;
    if (!expected.has(entry.operation)) {
      throw new Error(
        `${where} names the gg operation \`${entry.operation}\`, which no binding table in ` +
          "src/catalogue.ts lists. An operation gg has no row for is documentation no model reads, " +
          "because the entry is dropped before anything renders it.",
      );
    }
    if (claimed.has(entry.operation)) {
      throw new Error(
        `${where} and \`${claimed.get(entry.operation)}\` both claim the gg operation ` +
          `\`${entry.operation}\`.`,
      );
    }
    claimed.set(entry.operation, entry.fqn);
    if (moduleOf(entry.operation) !== entry.id) {
      throw new Error(
        `${where} is declared in the module \`${entry.id}\` and names the operation ` +
          `\`${entry.operation}\`, whose namespace is \`${moduleOf(entry.operation)}\`.`,
      );
    }
    const derived = exportedName(keyOf(entry.operation));
    if (derived !== entry.name) {
      throw new Error(
        `${where} binds \`${entry.operation}\`, whose key names \`${derived}\` rather than ` +
          `\`${entry.name}\`. The shim binds an operation by deriving the export from its key, so ` +
          "the two have to be one transformation apart.",
      );
    }
    const returned = entry.nodes[0].type ? print(entry.nodes[0].type, entry.sourceFile) : NO_RETURN;
    const prose = callProse(entry.nodes[0], entry.sourceFile, where, returned);
    const signatures = signaturesOf(entry.nodes, entry.sourceFile, entry.name, where);
    const written = signatures.flatMap((shape) => shape.parameters.map((p) => p.type));
    const types = resolver.closure(returned, ...written, ALWAYS_REFERENCED);
    for (const reference of types) reached.add(reference.fqn);
    functions.push({
      operation: entry.operation,
      // The canonical binding: the exported module function is where an operation is offered, and
      // the aliases appended below are second ways to reach one of these.
      aliasOf: null,
      module: entry.id,
      kind: "function",
      receiver: null,
      name: entry.name,
      fqn: entry.fqn,
      // The fully-qualified name IS what a program writes: the shim binds `gg` with one object per
      // module, and binds each module under its bare id as well, so there is no third spelling for a
      // call site to need.
      call: null,
      brief: prose.brief,
      detail: prose.detail,
      signatures,
      returns: resolver.direct(returned),
      types,
    });
  }

  const missing = [...expected].filter((operation) => !claimed.has(operation));
  if (missing.length > 0) {
    throw new Error(
      `${JSON.stringify(missing)} are operations \`OPERATIONS\` says this arm implements and no ` +
        `declaration binds. Write \`@${OPERATION_TAG} <id>\` on the function that implements each, ` +
        "or take the row out of src/catalogue.ts.",
    );
  }

  // The aliases, after every canonical binding is known, so that a helper naming an operation this
  // SDK does not otherwise offer fails here rather than reaching a model as the only way to call
  // something. They are appended in one block rather than interleaved into their modules because
  // that is the order they are: fifty operations, and then the short ways to reach five of them.
  for (const helper of helpers) {
    const name = helper.node.name.getText(helper.sourceFile);
    const fqn = `${helper.type.fqn}.${name}`;
    const where = `\`${fqn}\``;
    const operation = tagText(helper.node, helper.sourceFile, OPERATION_TAG);
    if (!operation) {
      throw new Error(
        `${where} is a method on a catalogued type and names no gg operation. Write ` +
          `\`@${OPERATION_TAG} <namespace>.<key>\` on it: a helper is a second way to reach one ` +
          "operation, and gg gates it as that operation.",
      );
    }
    if (!claimed.has(operation)) {
      throw new Error(
        `${where} is an alias of \`${operation}\`, which no exported function of this SDK binds. ` +
          "An alias is a shorter way to reach a call, never the only way to reach one.",
      );
    }
    const returned = helper.node.type ? print(helper.node.type, helper.sourceFile) : NO_RETURN;
    const prose = callProse(helper.node, helper.sourceFile, where, returned);
    const signatures = signaturesOf([helper.node], helper.sourceFile, name, where);
    const written = signatures.flatMap((shape) => shape.parameters.map((p) => p.type));
    const types = resolver.closure(returned, ...written, ALWAYS_REFERENCED);
    for (const reference of types) reached.add(reference.fqn);
    helper.type.memberFunctions.push({ operation, name, fqn, brief: prose.brief });
    functions.push({
      operation,
      aliasOf: operation,
      module: helper.id,
      kind: "method",
      receiver: helper.type.name,
      name,
      fqn,
      // Nothing to spell differently: the receiver is a value the program is holding, so
      // `handle.send(text)` is both the key this entry is filed under and the text of the call.
      call: null,
      brief: prose.brief,
      detail: prose.detail,
      signatures,
      returns: resolver.direct(returned),
      types,
    });
  }

  const unreached = declared.filter((type) => !reached.has(type.fqn)).map((type) => type.fqn);
  if (unreached.length > 0) {
    throw new Error(
      `${JSON.stringify(unreached)} are declared and nothing refers to them, so no documentation ` +
        "view of one could ever be opened. Remove them, or refer to them from the signature that " +
        "produces one.",
    );
  }

  return `${JSON.stringify(
    {
      schema: SCHEMA,
      language,
      generatedFrom: GENERATED_FROM,
      modules,
      functions,
      types: declared,
    },
    null,
    2,
  )}\n`;
}

/**
 * Where the catalogues are written, read from the environment and required.
 *
 * It takes no arguments at all rather than an optional flag with a default, so that the one place
 * that decides where a catalogue lands is the one place that knows the eleven arms —
 * `scripts/gg-signatures.sh`, which `crates/gg/build.rs` calls. A default here would be a second
 * answer, and this file's old default was the directory the catalogues stopped being committed in.
 */
function outputDirectory() {
  const outDir = process.env.GG_SIGNATURES_OUT_DIR;
  if (!outDir) {
    throw new Error(
      "GG_SIGNATURES_OUT_DIR is not set. It names the directory these catalogues are written " +
        "into, and there is no default — they are generated by the build rather than committed. " +
        "Run scripts/gg-signatures.sh, or set it yourself to a directory you want the JSON in.",
    );
  }
  return path.resolve(outDir);
}

async function main() {
  const outDir = outputDirectory();
  for (const language of LANGUAGES) {
    const out = path.join(outDir, `${language}.signatures.json`);
    const catalogue = await build(language);
    await mkdir(outDir, { recursive: true });
    await writeFile(out, catalogue, "utf8");
    const parsed = JSON.parse(catalogue);
    process.stdout.write(
      `Wrote ${path.relative(process.cwd(), out)} (${parsed.modules.length} modules, ` +
        `${parsed.functions.length} functions, ${parsed.types.length} types).\n`,
    );
  }
}

await main().catch((error) => {
  process.stderr.write(`signatures: ${error.message}\n`);
  process.exit(1);
});
