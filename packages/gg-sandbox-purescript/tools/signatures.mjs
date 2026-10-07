/**
 * Emit the signature catalogue for the PureScript arm:
 *
 *   packages/gg-sandbox-purescript/src/Gg/**  --this script-->  $GG_SIGNATURES_OUT_DIR/purescript.signatures.json
 *   packages/gg-sandbox-purescript/spago.yaml                -->  its `libraries` section
 *
 * gg answers every documentation search and every documentation view out of that file, so it is the
 * whole of what a model can *learn* about this arm's surface — the responses-as-code system prompt
 * takes only the module paths and their one-line briefs from it and names no function at all. Every
 * word of it is reflected out of the declaration it describes rather than written anywhere else. A
 * description kept in a table, a template or a `const` in gg's Rust is a description that drifts
 * from its subject with nothing to catch it.
 *
 * # It reads `purs`, which is what a PureScript author already writes
 *
 * `purs compile --codegen docs` emits a `docs.json` per module carrying every exported declaration's
 * doc comment and its full type, with the types already resolved to the module that declares them.
 * So a signature here is the compiler's own reading of the SDK, not a second copy of it, and a
 * renamed argument or a changed type reaches the model's prompt as the rename rather than as a
 * sentence that quietly stopped being true.
 *
 * # The surface is capability modules, and a name is what a program writes
 *
 * Each module in `tools/catalogue.mjs` is a real PureScript module with an explicit export list, so
 * the public surface is a compiler-enforced protocol rather than a convention. A fully-qualified
 * name is `Gg.Files.readFile`: a program writes `import Gg.Files as Gg.Files` and then writes that
 * expression, so the key a documentation view is opened by and the call site are one string, and
 * `call` is therefore `null` on every entry.
 *
 * # What this language does not have, and the conventions that replace it
 *
 * **Per-parameter documentation.** A type says `String -> Int -> Effect Unit` and names nothing, and
 * `purs` discards a comment written on a record field in all three placements it might go. So both
 * are written as a `# Arguments` (or `# Fields`) list in the declaration's own doc comment, and this
 * script is what turns them into structure. The completeness rules below are what stop the
 * convention from being decoration:
 *
 *   * a signature that takes N arguments must document N, in order;
 *   * every field of a record argument must be documented, and every documented field must exist;
 *   * a `# Fields` list must name every field of the type it is on, and only those;
 *   * an argument's description is one paragraph, because a parameter carries a brief and nothing
 *     else; a field's first paragraph is its brief and any that follow are its detail;
 *   * a call that hands something back documents it under `# Returns`, and one that hands back
 *     `Effect Unit` documents no such section;
 *   * a heading outside the closed set this convention reads is refused, so a mistyped one is a
 *     build failure rather than a paragraph nobody is ever shown;
 *   * nothing may be blank.
 *
 * **An attribute a declaration can carry.** gg's identity for a call — that `Gg.Files.readFile` is
 * gg's `files.read_file` operation, the same capability C# spells `Gg.Files.ReadFile` — is the
 * one thing PureScript's syntax cannot say. It is written on the declaration all the same, in a
 * `# Operation` section of that declaration's own doc comment, or in an `# Alias` section where the
 * declaration is a second, shorter way to reach an operation another one already binds. On the
 * declaration rather than in `catalogue.mjs`, because a side table naming every function twice is
 * the second copy that drifts.
 *
 * **A member on a value.** A record has fields and no behaviour, so the convenience another arm
 * hangs off a value — `view.close()` — is a free function over that value here. That is the
 * equivalent shape rather than a shortfall, and it is why `memberFunctions` is empty on every type
 * this SDK declares.
 *
 * Each of those is a `throw` here rather than a `null` in the JSON, because the failure would
 * otherwise land on a model reading a signature it cannot act on.
 *
 * # Usage
 *
 *   GG_SIGNATURES_OUT_DIR=<dir> packages/gg-sandbox-purescript/signatures.sh
 *
 * which unpacks the library tree `gg-artifact-purescript` built, stages this package's `src/` into
 * it, compiles the lot
 * with `--codegen docs` first, and is what turns the environment variable into the destination
 * below. The catalogue is not committed anywhere: `crates/gg/build.rs` generates it through
 * `scripts/gg-signatures.sh` on every build of gg that needs it, so an edit to a doc comment IS the
 * regeneration — there is no second copy of it to leave behind.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE, MODULES } from "./catalogue.mjs";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where the catalogue is written, taken from the environment and required.
 *
 * There is no default, in the same style as the `argv` guard below and for a stronger reason: the
 * one place that decides where a catalogue lands is `scripts/gg-signatures.sh`, which
 * `crates/gg/build.rs` calls, and a default here would be a second answer to that question. The
 * answer this file used to give — the Rust crate's own `sandbox/guests/` directory — is precisely
 * the one that stopped being right, because nothing is committed there any more.
 */
const OUT_DIR = process.env.GG_SIGNATURES_OUT_DIR;
if (!OUT_DIR) {
  throw new Error(
    "GG_SIGNATURES_OUT_DIR is not set; run packages/gg-sandbox-purescript/signatures.sh or " +
      "scripts/gg-signatures.sh",
  );
}
const OUT = join(OUT_DIR, "purescript.signatures.json");

/** The schema this catalogue is written in: modules, operations, fully-qualified names, authored
 * briefs and resolved type references. */
const SCHEMA = 1;

/** What the emitted catalogue records itself as reflected from. */
const GENERATED_FROM =
  "packages/gg-sandbox-purescript/src/Gg/ + spago.yaml (purs --codegen docs)";

/** The types every failure names, closed over on every entry because every call here throws one. */
const ALWAYS_REFERENCED = ["Gg.Core.ApiError", "Gg.Core.ApiErrorCode"];

/**
 * The longest a brief may be, in characters.
 *
 * The same cap `crates/gg/src/sandbox/language/register.rs` holds every arm's catalogue to, and it is
 * enforced here as well because the host's copy is a `#[test]`: a reflection that embedded a
 * paragraph in the brief field would succeed, and so would a build, and the author would hear about
 * it from a gate three steps away naming an entry they then have to go looking for. Here is where the
 * author is standing.
 *
 * It carries more weight on this arm than on most, because {@link unwrap} runs first: a `-- |`
 * comment whose opening paragraph is three sentences over four wrapped lines arrives at
 * {@link split} as ONE line, so no shape check could tell it from a brief and this length is the only
 * thing that can.
 */
const BRIEF_CAP = 120;

/** Where `signatures.sh` put the `--codegen docs` output, and the tree it compiled against. */
const [DOCS_DIR, TREE_DIR] = process.argv.slice(2);
if (!DOCS_DIR || !TREE_DIR) {
  throw new Error("usage: signatures.mjs <docs output dir> <library tree dir>");
}

// ---------------------------------------------------------------------------------------------
// Reading what `purs` emitted
// ---------------------------------------------------------------------------------------------

/** Every `Gg*` module `purs` documented, by module name. */
function loadModules() {
  const modules = new Map();
  for (const entry of readdirSync(DOCS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("Gg")) continue;
    const document = JSON.parse(
      readFileSync(join(DOCS_DIR, entry.name, "docs.json"), "utf8"),
    );
    const values = new Map();
    const types = new Map();
    const order = [];
    for (const declaration of document.declarations) {
      const kind = declaration.info.declType;
      if (kind === "value") values.set(declaration.title, declaration);
      else if (kind === "typeSynonym" || kind === "data") {
        types.set(declaration.title, declaration);
        order.push(declaration.title);
      }
    }
    modules.set(entry.name, {
      comments: document.comments,
      values,
      types,
      order,
    });
  }
  return modules;
}

const MODULES_BY_NAME = loadModules();

/**
 * The catalogued modules and the documented ones are the same set, in both directions.
 *
 * A module the table names and nobody compiled would be a documented path no name resolves under; a
 * `Gg.*` module nobody catalogued would be a public surface no model is ever told about, which is
 * the failure the export lists exist to make impossible. `Gg.Internal.*` is neither: it is this
 * SDK's own plumbing, exported for the other modules and named so in its own path.
 */
function checkModules() {
  for (const module_ of MODULES) {
    if (!MODULES_BY_NAME.has(module_.path)) {
      throw new Error(
        `\`purs\` documented no module called ${module_.path}; is it in src/?`,
      );
    }
  }
  const catalogued = new Set(MODULES.map((module_) => module_.path));
  for (const name of MODULES_BY_NAME.keys()) {
    if (!catalogued.has(name) && !name.startsWith("Gg.Internal.")) {
      throw new Error(
        `${name} is a model-facing module that tools/catalogue.mjs does not name — add it there, ` +
          "or move it under Gg.Internal if it is this SDK's own plumbing",
      );
    }
  }
}

/** One module's documented declarations, or a failure naming the module nobody compiled. */
function moduleDocs(name) {
  const found = MODULES_BY_NAME.get(name);
  if (found === undefined) {
    throw new Error(
      `\`purs\` documented no module called ${name}; is it in src/ and exported?`,
    );
  }
  return found;
}

/** One exported value declaration. */
function value(module_, name) {
  const found = moduleDocs(module_).values.get(name);
  if (found === undefined) {
    throw new Error(`${module_} exports no value called \`${name}\``);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The declared types
// ---------------------------------------------------------------------------------------------

/**
 * Every type a catalogued module declares, by the fully-qualified name it answers to.
 *
 * A type is catalogued exactly when a **catalogued module declares it**, which is what makes every
 * fully-qualified name in this artifact a real PureScript path. A `data` declaration and a record
 * synonym are both shapes a model reads; a **row** synonym — `ReadOptions`, `UpdateTaskOptions` — is
 * not, because the row is what an optional-argument record stands for and it is rendered inline,
 * field by marked field, into the signature that takes it. Neither is exported for a model's sake:
 * PureScript requires a type named by an exported signature to be exported too.
 */
function declaredTypes() {
  const declared = new Map();
  for (const module_ of MODULES) {
    for (const name of moduleDocs(module_.path).order) {
      const declaration = moduleDocs(module_.path).types.get(name);
      if (!isModelFacingType(declaration)) continue;
      declared.set(`${module_.path}.${name}`, {
        module: module_,
        name,
        declaration,
      });
    }
  }
  return declared;
}

/** Whether a type declaration is a shape a model reads, rather than a row an argument stands for. */
function isModelFacingType(declaration) {
  if (declaration.info.declType === "data") return true;
  return recordRow(declaration.info.type) !== undefined;
}

const DECLARED = (() => {
  checkModules();
  return declaredTypes();
})();

// ---------------------------------------------------------------------------------------------
// The type printer
// ---------------------------------------------------------------------------------------------

/** A type node with its parentheses peeled off. */
function bare(node) {
  return node.tag === "ParensInType" ? bare(node.contents) : node;
}

/** The name a `TypeConstructor` names, and the module it came from. */
function constructor_(node) {
  if (bare(node).tag !== "TypeConstructor") return undefined;
  const [path, name] = bare(node).contents;
  return { module: path.join("."), name, fqn: `${path.join(".")}.${name}` };
}

/** Whether `node` is the constructor `module.name`. */
function isConstructor(node, module_, name) {
  const found = constructor_(node);
  return found !== undefined && found.module === module_ && found.name === name;
}

/** `A -> B`, split into its halves, or `undefined` for anything else. */
function arrow(node) {
  const applied = bare(node);
  if (applied.tag !== "TypeApp") return undefined;
  const [left, result] = applied.contents;
  const inner = bare(left);
  if (inner.tag !== "TypeApp") return undefined;
  const [fn, argument] = inner.contents;
  if (!isConstructor(fn, "Prim", "Function")) return undefined;
  return { argument, result };
}

/** The row a `Record` applies, or `undefined` for anything that is not a record. */
function recordRow(node) {
  const applied = bare(node);
  if (applied.tag !== "TypeApp") return undefined;
  const [fn, row] = applied.contents;
  return isConstructor(fn, "Prim", "Record") ? row : undefined;
}

/** A row's own fields, and whatever its tail is. */
function rowFields(node) {
  const fields = [];
  let current = bare(node);
  while (current.tag === "RCons") {
    const [label, type, rest] = current.contents;
    fields.push({ label, type });
    current = bare(rest);
  }
  return { fields, tail: current };
}

/**
 * One type, as PureScript writes it. `optional` resolves a row variable to the row it stands for.
 *
 * A type this SDK declares is written **module-qualified**, because that is what a program writes:
 * the modules are imported under their own full names, so `Gg.Files.FileRead` is the expression a
 * signature's reader copies and the key its documentation view is opened by, and a bare `FileRead`
 * would be a spelling that does not resolve. Everything else — `String`, `Int`, `Array`, `Maybe`,
 * `Effect` — is written by its last segment, which is PureScript's own and is in every program's
 * scope through `Prelude` and the imports the prompt names.
 */
function renderType(node, optional) {
  const type = bare(node);
  const split = arrow(type);
  if (split !== undefined) {
    return `${renderLeft(split.argument, optional)} -> ${renderType(split.result, optional)}`;
  }
  const row = recordRow(type);
  if (row !== undefined) return renderRecord(row, optional);
  if (type.tag === "TypeApp") {
    const [fn, argument] = type.contents;
    return `${renderType(fn, optional)} ${renderApplied(argument, optional)}`;
  }
  if (type.tag === "TypeConstructor") {
    const named = constructor_(type);
    return DECLARED.has(named.fqn) ? named.fqn : named.name;
  }
  if (type.tag === "TypeVar") return type.contents;
  throw new Error(`this script cannot print a ${type.tag} type`);
}

/**
 * One type to the LEFT of an arrow, where only another arrow needs parentheses: application binds
 * tighter than `->`, so `Array String -> Effect Unit` is what a PureScript author writes.
 */
function renderLeft(node, optional) {
  const rendered = renderType(node, optional);
  return rendered.includes(" -> ") ? `(${rendered})` : rendered;
}

/** One type in an APPLICATION's argument position, where anything applied needs parentheses. */
function renderApplied(node, optional) {
  const rendered = renderType(node, optional);
  const simple = !rendered.includes(" ") || rendered.startsWith("{");
  return simple ? rendered : `(${rendered})`;
}

/**
 * A record type, with a row variable resolved to the optional fields it stands for.
 *
 * An optional field is written `offset? :: Int`. That is notation rather than PureScript — the real
 * declaration is `Union given rest ReadOptions => String -> Record given -> Effect FileRead`, and
 * `Record given` on its own says nothing at all, so the choice is between rendering the whole
 * constrained head and marking the fields the row stands for. Rendered flat and unmarked, the
 * signature reads as a CLOSED record — "every field is required" — which is the one place a model
 * would be told something stricter than what it is compiled against. `?` is the marker
 * TypeScript's own catalogue
 * carries for the same fact (`{ offset?: number }`), so the two arms read alike here — while Python
 * and Ruby say it with a default, which is what those languages write.
 */
function renderRecord(row, optional) {
  const fields = recordFields(row, optional);
  if (fields.length === 0) return "{}";
  const rendered = fields.map(
    (field) => `${field.name}${field.optional ? "?" : ""} :: ${field.type}`,
  );
  return `{ ${rendered.join(", ")} }`;
}

/**
 * Every field of a record type, required ones first and the row variable's optional ones after.
 *
 * A row variable that stands for nothing is an error rather than an empty list: it means a signature
 * carries a `Union` constraint this script never saw, and the model would be shown an argument with
 * no fields at all.
 */
function recordFields(row, optional) {
  const { fields, tail } = rowFields(row);
  const required = fields.map((field) => ({
    name: field.label,
    type: renderType(field.type, optional),
    optional: false,
  }));
  if (tail.tag === "REmpty") return required;
  if (tail.tag !== "TypeVar")
    throw new Error(`this script cannot print a ${tail.tag} row tail`);
  const resolved = optional.get(tail.contents);
  if (resolved === undefined) {
    throw new Error(
      `the row variable \`${tail.contents}\` is not bound by a Union constraint`,
    );
  }
  return required.concat(
    resolved.map((field) => ({
      name: field.label,
      type: renderType(field.type, optional),
      optional: true,
    })),
  );
}

/**
 * Peel the `forall` binders and the constraints off a declaration's type, recording what each
 * `Union` constraint says an optional row variable stands for.
 */
function peel(node) {
  const optional = new Map();
  let type = bare(node);
  for (;;) {
    if (type.tag === "ForAll") {
      type = bare(type.contents.type);
      continue;
    }
    if (type.tag === "ConstrainedType") {
      const [constraint, body] = type.contents;
      readConstraint(constraint, optional);
      type = bare(body);
      continue;
    }
    return { type, optional };
  }
}

/** What one constraint contributes: a `Union` says which optional row a variable stands for. */
function readConstraint(constraint, optional) {
  const [namespace, name] = constraint.constraintClass;
  if (namespace.join(".") !== "Prim.Row" || name !== "Union") {
    throw new Error(`this script does not understand the ${name} constraint`);
  }
  const [given, , row] = constraint.constraintArgs;
  const variable = bare(given);
  if (variable.tag !== "TypeVar") {
    throw new Error(
      "a Union constraint's first argument must be the row variable it constrains",
    );
  }
  optional.set(variable.contents, resolveRow(row));
}

/** The fields of an optional row, whether written inline or behind a row synonym. */
function resolveRow(node) {
  const named = constructor_(node);
  if (named === undefined) return rowFields(node).fields;
  const declaration = moduleDocs(named.module).types.get(named.name);
  if (
    declaration === undefined ||
    declaration.info.declType !== "typeSynonym"
  ) {
    throw new Error(
      `${named.module}.${named.name} is not a row synonym this script can resolve`,
    );
  }
  return rowFields(declaration.info.type).fields;
}

// ---------------------------------------------------------------------------------------------
// The type references a signature carries
// ---------------------------------------------------------------------------------------------

/**
 * Every catalogued type `node` mentions **directly**, by fully-qualified name, in mention order.
 *
 * A row synonym is followed rather than recorded: `UpdateTaskOptions` is not a type a model reads,
 * but the types its fields are typed by are — without following it, `status :: Gg.Tasks.TaskStatus`
 * would reach a model as a name nothing in the catalogue declares.
 */
function mentions(node, found = [], seenRows = new Set()) {
  const walk = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) walk(item);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    const named = constructor_(candidate);
    if (named !== undefined && DECLARED.has(named.fqn)) {
      if (!found.includes(named.fqn)) found.push(named.fqn);
    } else if (
      named !== undefined &&
      named.module.startsWith("Gg.") &&
      !seenRows.has(named.fqn)
    ) {
      seenRows.add(named.fqn);
      const row = MODULES_BY_NAME.get(named.module)?.types.get(named.name);
      if (row !== undefined && row.info.declType === "typeSynonym") {
        mentions(row.info.type, found, seenRows);
      }
    }
    for (const nested of Object.values(candidate)) walk(nested);
  };
  walk(node);
  return found;
}

/**
 * A set of fully-qualified names, transitively closed through the declarations they name.
 *
 * Transitive because the list answers *which declarations does this run's surface reach*, which is
 * what decides whether a type may be opened at all: a type buried two levels inside a bound call's
 * result is plainly one the program can hold. What a documentation view opens beside a function is a
 * depth-one question gg answers for itself from `returns` and the signature text, so widening here
 * costs nothing there.
 */
function closure(names) {
  const pending = [...names];
  const seen = [];
  while (pending.length > 0) {
    const fqn = pending.shift();
    if (seen.includes(fqn) || !DECLARED.has(fqn)) continue;
    seen.push(fqn);
    const { declaration } = DECLARED.get(fqn);
    const reached = [];
    if (declaration.info.type !== undefined && declaration.info.type !== null) {
      mentions(declaration.info.type, reached);
    }
    for (const child of declaration.children ?? []) {
      mentions(child.info.arguments ?? [], reached);
    }
    pending.push(...reached);
  }
  return seen;
}

/** A list of fully-qualified names, as the catalogue's resolved type references. */
function references(names) {
  // The spelling and the resolution are the same string on this arm, deliberately: a signature
  // writes the module-qualified name because that is the expression a program writes, so there is no
  // second spelling for a model to read and fail to look up.
  return names.map((fqn) => ({ spelled: fqn, fqn }));
}

// ---------------------------------------------------------------------------------------------
// The doc comment
// ---------------------------------------------------------------------------------------------

/**
 * Every `#` heading this convention knows, and therefore every heading a declaration may write.
 *
 * The set is closed, and closing it is not tidiness. A heading this script does not read is a
 * section that vanishes: `# Retruns` parses perfectly, lands in the map, and is never asked for
 * again, so an author who mistyped one would have written a paragraph no model will ever be shown
 * and no gate would have said so. That failure has already been shipped twice on this project by
 * reflectors that read a subset of what their authors wrote, and both times the only thing that
 * caught it was somebody counting tags against catalogue lines by hand.
 */
const HEADINGS = [
  "Operation",
  "Alias",
  "Arguments",
  "Fields",
  "Returns",
  "Throws",
];

/**
 * One doc comment, split into the prose a model reads and the `#` sections this convention carries.
 *
 * A declaration with no comment at all is a failure rather than an empty description: everything in
 * this catalogue is read by a model, and a blank is worse than a missing entry because nothing
 * downstream can tell it from a description.
 */
function comment(declaration, what) {
  const text = declaration.comments;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error(`${what} carries no documentation`);
  }
  const prose = [];
  const sections = new Map();
  let current = prose;
  for (const line of text.split("\n")) {
    const heading = /^# (.+?)\s*$/.exec(line);
    if (heading !== null) {
      if (!HEADINGS.includes(heading[1])) {
        throw new Error(
          `${what} writes a \`# ${heading[1]}\` section, which this convention has no reader for; ` +
            `the headings it carries are ${HEADINGS.join(", ")}`,
        );
      }
      current = [];
      sections.set(heading[1], current);
      continue;
    }
    current.push(line);
  }
  return { prose: unwrap(prose), sections, what };
}

/**
 * A doc comment's prose as one string: paragraphs kept apart, the hard line breaks the source is
 * wrapped at taken out, and fenced code blocks left exactly as they were written.
 *
 * The wrapping is an artefact of an 100-column source file, not something a model should read; a
 * fenced example's line breaks are the example.
 *
 * It is also what makes the **brief** a single line without the author having to keep one inside the
 * source's line width: the brief is the first paragraph, and a paragraph is one line by the time it
 * leaves here.
 */
function unwrap(lines) {
  const blocks = [];
  let paragraph = [];
  let fence = null;
  const flush = () => {
    if (paragraph.length > 0) blocks.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (fence === null) {
        flush();
        fence = [line.trim()];
      } else {
        fence.push(line.trim());
        blocks.push(fence.join("\n"));
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  if (fence !== null)
    throw new Error("a doc comment has an unterminated code fence");
  return blocks.join("\n\n").trim();
}

/**
 * One piece of settled prose as `(brief, detail)`: the first paragraph, and the rest.
 *
 * Doxygen's implicit structure, which is the whole of the convention this SDK is written to. The
 * brief is authored rather than derived — there is no "first sentence of" anywhere in this file —
 * and the split is on the blank line the author put there, so a doc comment whose opening paragraph
 * is really three sentences of narrative is never silently cut at a full stop.
 *
 * It fails on {@link BRIEF_CAP} instead. The text reaching here has already been through
 * {@link unwrap}, so such a paragraph is one long line by now and no shape check could tell it from a
 * brief; its length can, and that is what this throws on — naming the declaration it was written on,
 * which is what the author is looking at.
 */
function split(text, what) {
  if (!text) throw new Error(`${what} has no documentation`);
  const [brief, ...rest] = text.split("\n\n");
  const detail = rest.join("\n\n").trim();
  const summary = brief.trim();
  if (summary.length > BRIEF_CAP) {
    throw new Error(
      `${what} has a ${summary.length}-character brief, and a brief is capped at ` +
        `${BRIEF_CAP}: ${JSON.stringify(summary)}`,
    );
  }
  return { brief: summary, detail: detail === "" ? null : detail };
}

/**
 * One `- \`name\` — description` list, as an ordered list of entries with their paragraphs.
 *
 * An entry's first paragraph is its brief. A paragraph that follows it — a blank line and then more
 * indented text — is its detail, which a **field** carries and an argument does not: gg's model gives
 * a parameter one line and a type's member a brief and a detail, and the convention says the same.
 */
function entries(parsed, heading) {
  const lines = parsed.sections.get(heading);
  if (lines === undefined) {
    throw new Error(`${parsed.what} has no \`# ${heading}\` section`);
  }
  const found = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length > 0 && found.length > 0) {
      found[found.length - 1].paragraphs.push(paragraph.join(" "));
    }
    paragraph = [];
  };
  for (const line of lines) {
    const item = /^- `([^`]+)` — (.*)$/u.exec(line);
    if (item !== null) {
      flush();
      found.push({ name: item[1], paragraphs: [] });
      paragraph = [item[2].trim()];
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (/^\s+\S/u.test(line) && found.length > 0) {
      paragraph.push(line.trim());
      continue;
    }
    // Anything else is the "(none)" body of a section that documents nothing, which is only legal
    // when there is nothing to document — checked by the caller, which knows how many there are.
    if (found.length > 0) {
      throw new Error(
        `${parsed.what}'s \`# ${heading}\` list has a line this script cannot read: ${line}`,
      );
    }
  }
  flush();
  for (const entry of found) {
    if (entry.paragraphs.length === 0 || entry.paragraphs[0] === "") {
      throw new Error(
        `${parsed.what} documents \`${entry.name}\` with nothing`,
      );
    }
  }
  return found;
}

/** One entry's brief, refusing the detail an argument has nowhere to put. */
function brieflyDocumented(parsed, entry) {
  if (entry.paragraphs.length > 1) {
    throw new Error(
      `${parsed.what} gives \`${entry.name}\` more than one paragraph; an argument's ` +
        "documentation is a single line, because that is the whole of what gg's model carries for one",
    );
  }
  return entry.paragraphs[0];
}

/**
 * The gg operation a declaration binds, and whether it is that operation's binding or a second way
 * to reach it.
 *
 * Both are written the same way and in one place — `# Operation` for the binding, `# Alias` for a
 * second way to reach one — so the id is never written twice on one declaration and there is no
 * separate flag for the two to disagree with. An alias is what this arm's convenience helpers are:
 * `Gg.Board.waitFor` over an `IssueCreated` reaches the same `board.wait_for_issue` that
 * `Gg.Board.waitForIssue` does, under the same gate, and it adds nothing to what this arm covers.
 */
function operationOf(parsed, module_) {
  const operation = parsed.sections.get("Operation");
  const alias = parsed.sections.get("Alias");
  if (operation !== undefined && alias !== undefined) {
    throw new Error(
      `${parsed.what} writes both an \`# Operation\` and an \`# Alias\` section; a declaration is ` +
        "either an operation's binding or a second way to reach one, and never both",
    );
  }
  const lines = operation ?? alias;
  if (lines === undefined) {
    throw new Error(
      `${parsed.what} is exported and names no gg operation, so a model would never be told it ` +
        "exists — give it a `# Operation` section naming one, as `<namespace>.<key>`",
    );
  }
  const heading = operation === undefined ? "Alias" : "Operation";
  const text = lines.join("\n").trim();
  if (!/^[a-z_]+\.[a-z_]+$/u.test(text)) {
    throw new Error(
      `${parsed.what}'s \`# ${heading}\` section is not one \`<namespace>.<key>\` id: ${text}`,
    );
  }
  const [namespace] = text.split(".");
  if (namespace !== module_.id) {
    throw new Error(
      `${parsed.what} binds the operation \`${text}\`, whose namespace is not this module's gg id ` +
        `\`${module_.id}\` — a module and the operations it binds are one vocabulary`,
    );
  }
  return { operation: text, aliasOf: operation === undefined ? text : null };
}

/** One folded section's body, refusing a heading written with nothing under it. */
function section(parsed, heading) {
  const lines = parsed.sections.get(heading);
  if (lines === undefined) return undefined;
  const text = unwrap(lines);
  if (text === "")
    throw new Error(`${parsed.what} has an empty \`# ${heading}\` section`);
  return text;
}

/**
 * Every failure name a `# Throws` section may write, by the fully-qualified type that declares it.
 *
 * A section names its failure the way a program branches on one — `NotFound`, `LimitExceeded` — and
 * on this arm those are **data constructors of `Gg.Core.ApiErrorCode`** rather than types in their
 * own right, because there is one thrown value here and a closed set of codes on it. So this arm has
 * a real resolution to do where a language with an exception class per failure has none, and it is
 * why the references it emits below are the `{ spelled, fqn }` form rather than the one string
 * {@link references} emits everywhere else: the spelling is the word a model reads in the sentence
 * beside the signature, and the name it resolves to is the declaration a documentation view can
 * actually be opened by.
 *
 * It is built over every catalogued `data` type rather than over `ApiErrorCode` by name, so a second
 * failure vocabulary would resolve here without this map being told about it. A name two types both
 * declared would make the resolution a coin toss and is refused rather than resolved to whichever
 * was walked first.
 */
const FAILURE_NAMES = (() => {
  const named = new Map();
  for (const [fqn, { declaration }] of DECLARED) {
    for (const child of declaration.children ?? []) {
      if (child.info.declType !== "dataConstructor") continue;
      const claimed = named.get(child.title);
      if (claimed !== undefined) {
        throw new Error(
          `both \`${claimed}\` and \`${fqn}\` declare \`${child.title}\`; a failure named in a ` +
            "`# Throws` section has to name one type, or the view opened beside it is whichever " +
            "this walk reached first",
        );
      }
      named.set(child.title, fqn);
    }
  }
  return named;
})();

/**
 * The failure type a declaration's `# Throws` section declares, as a resolved type reference, or an
 * empty list where the declaration writes no such section.
 *
 * **Only what is written counts.** A declaration with no `# Throws` section hands back an empty
 * list, which records that its author declared no failure rather than claiming the call cannot fail
 * — every call in this SDK can, and `Gg.Core.ApiError` is in every entry's {@link ALWAYS_REFERENCED}
 * reach for exactly that reason. What this field adds is the failure the *author singled out*, and
 * nothing is inferred from a type, from `attempt`, or from what a sibling arm declared for the same
 * operation.
 *
 * **The first backticked name is the answer, and one entry is the whole of it.** The section is
 * written failure-first — "`NotFound`, naming the ids that are held, for an id this agent was
 * never issued" — so the name it opens with is the failure it declares. A section naming several codes is
 * naming several *arms of one type*, so the resolved list is the same one entry whichever arm it
 * opened with; the sentence carrying all of them goes on saying so, untouched, in the detail
 * {@link documented} folds. A section opening with a name no catalogued type declares is refused
 * here rather than emitted, because the one reader this list has opens a documentation view of every
 * name in it and a name that resolves to nothing is a view that cannot be opened.
 */
function declaredFailures(parsed) {
  const text = section(parsed, "Throws");
  if (text === undefined) return [];
  const written = /`([^`]+)`/u.exec(text);
  if (written === null) {
    throw new Error(
      `${parsed.what}'s \`# Throws\` section names no failure; a section is written to say which ` +
        "failure a caller branches on, and the name is written in backticks",
    );
  }
  const spelled = written[1];
  const fqn = FAILURE_NAMES.get(spelled);
  if (fqn === undefined) {
    throw new Error(
      `${parsed.what}'s \`# Throws\` section opens with \`${spelled}\`, which no catalogued type ` +
        "declares; a section opens with the failure it declares, as the `Gg.Core.ApiErrorCode` arm " +
        "a caller branches on",
    );
  }
  return [{ spelled, fqn }];
}

/**
 * A declaration's brief and detail, with what it hands back and what it throws folded onto the end
 * of the detail under their own headings.
 *
 * **`Throws`, not `Raises`.** The word is the one PureScript's own vocabulary uses: the exception
 * effect is `Effect.Exception.throw`, `throwException` and `catchException`, and there is no `raise`
 * anywhere in it. `# Raises` was gg's invention rather than the language's — this arm has no
 * doc-tag machinery for a reflector to have read a word out of, so the heading was chosen rather
 * than reflected, and it was chosen wrong. The rule the correction is made under is that the failure
 * section's word is whatever the arm's own convention uses, and no reflector may rename or invent
 * one.
 *
 * `# Returns` is folded first because that is the order a reader wants them in: what the call hands
 * back on the ordinary path, and then how the path can fail. Both are markdown headings rather than
 * inline lead-in lines, matching `# Arguments` and `# Fields`, because pursuit renders a doc comment
 * as markdown and a heading is what this arm already writes.
 */
function documented(parsed) {
  const { brief, detail } = split(parsed.prose, parsed.what);
  const returned = section(parsed, "Returns");
  const thrown = section(parsed, "Throws");
  const parts = [
    detail,
    returned === undefined ? null : `# Returns\n\n${returned}`,
    thrown === undefined ? null : `# Throws\n\n${thrown}`,
  ];
  const whole = parts
    .filter((part) => part !== null && part !== "")
    .join("\n\n");
  return { brief, detail: whole === "" ? null : whole };
}

// ---------------------------------------------------------------------------------------------
// One function
// ---------------------------------------------------------------------------------------------

/** Each catalogued module's own source, by module path, read once. */
const SOURCES = new Map();

/** One catalogued module's `.purs` source, which is this package's own `src/` rather than the tree
 * `purs` compiled — the two are the same text, and this one is where a human edits it. */
function sourceOf(modulePath) {
  let source = SOURCES.get(modulePath);
  if (source === undefined) {
    // A module path is its own directory path in this language, so `Gg.Files` is `Gg/Files.purs` and
    // nothing else here has to know the layout.
    const segments = modulePath.split(".");
    segments[segments.length - 1] += ".purs";
    source = readFileSync(join(PACKAGE, "src", ...segments), "utf8");
    SOURCES.set(modulePath, source);
  }
  return source;
}

/**
 * The argument names the **defining equation** of `name` binds, in order, or `undefined` where it
 * binds none this can read.
 *
 * This is the one thing on this arm that the compiler cannot be asked. `purs` emits no binder names
 * for a curried function — a type is `String -> String -> String -> Int` and names nothing — so the
 * only place the argument *order* is written down twice is the definition and its own doc comment,
 * and [`checkBinders`](#checkBinders) is what holds the two together.
 *
 * The source is where the answer is, so the source is read. Only an equation whose binders are all
 * plain names is read; a point-free definition or a pattern binder answers `undefined` and is
 * skipped, because weakening the rule to accommodate one shape would drop it for every shape.
 */
function binderNames(modulePath, name) {
  const equation = new RegExp(
    `^${name}((?:[ \\t]+[a-z_][\\w']*)*)[ \\t]*=(?!=)`,
    "mu",
  );
  const found = equation.exec(sourceOf(modulePath));
  if (found === null) return undefined;
  return found[1].split(/\s+/u).filter((binder) => binder !== "");
}

/**
 * The `# Arguments` list is not a **permutation** of the equation's binders.
 *
 * The check is deliberately about order alone and not about the names themselves, because the two
 * are answering different questions and are allowed to differ. A binder is the definition's own
 * word for a value it is about to lower — `writeMemory written` — while a documented name is what a
 * *model* is told the argument is, and holding the second to the first would be this script having
 * an opinion about how the SDK spells its own locals. So a list whose names simply do not match the
 * binders is a rename and is left alone.
 *
 * What is caught is the case where they match as a **set** and disagree as a **sequence**, which
 * cannot be a rename and can only be a transposition: either two `# Arguments` lines were swapped,
 * or two binders were, and nothing else in this arm would notice. `agreement.rs::names_arguments`
 * skips the "a documented name appears in the signature" check for ML notation because a curried
 * type names nothing, and the type gives no cover where consecutive arguments share one —
 * `editFile path oldString newString` is three `String`s. The catalogue would regenerate green
 * telling a model to write `editFile path newString oldString`, the edit would fail at run time as
 * "old string not found", and it would read as the model's mistake.
 *
 * Thrown from here rather than reported as a diff, for the reason the arity check beside it is: the
 * author is standing at the declaration.
 *
 * A count that disagrees is **not** reported here. The arity the catalogue is held to is the one the
 * *type* declares, which [`shapeOf`](#shapeOf) has already checked against the documentation; a
 * definition free to bind fewer binders than its type takes arguments — returning a function for the
 * rest — is ordinary curried PureScript, and reporting it from here would be this check having an
 * opinion about a shape that is none of its business. So a disagreement means there is no ordering
 * to compare and the equation is skipped.
 */
function checkBinders(modulePath, name, parsed, documentedNames) {
  const binders = binderNames(modulePath, name);
  if (binders === undefined || binders.length !== documentedNames.length)
    return;
  const sorted = (names) => [...names].sort().join("\u0000");
  if (sorted(binders) !== sorted(documentedNames)) return;
  for (const [index, binder] of binders.entries()) {
    if (binder === documentedNames[index]) continue;
    throw new Error(
      `${parsed.what} binds \`${binders.join(" ")}\` and documents ` +
        `\`${documentedNames.join(" ")}\` — the same names in a different order. The ` +
        "`# Arguments` list is the order a model is told to call in, so it has to be the order the " +
        "definition takes them in",
    );
  }
}

/** One calling shape: the signature as `purs` reads it, and the arguments the convention names. */
function shapeOf(modulePath, declaration, name, parsed) {
  const { type, optional } = peel(declaration.info.type);

  const argumentTypes = [];
  let rest = type;
  for (;;) {
    const split_ = arrow(rest);
    if (split_ === undefined) break;
    argumentTypes.push(split_.argument);
    rest = bare(split_.result);
  }

  const documented_ = entries(parsed, "Arguments");
  const top = documented_.filter((entry) => !entry.name.includes("."));
  if (top.length !== argumentTypes.length) {
    throw new Error(
      `${parsed.what} takes ${argumentTypes.length} arguments and documents ${top.length}; ` +
        "every argument needs a `- `name` — what it is for` line, in order",
    );
  }
  checkBinders(
    modulePath,
    name,
    parsed,
    top.map((entry) => entry.name),
  );

  const parameters = top.map((entry, index) => {
    const node = argumentTypes[index];
    const row = recordRow(node);
    const fields = row === undefined ? [] : recordFields(row, optional);
    const documentedFields = documented_
      .filter((candidate) => candidate.name.startsWith(`${entry.name}.`))
      .map((candidate) => ({
        ...candidate,
        name: candidate.name.slice(entry.name.length + 1),
      }));
    return {
      name: entry.name,
      type: renderType(node, optional),
      optional: false,
      kind: "positional",
      default: null,
      doc: brieflyDocumented(parsed, entry),
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        optional: field.optional,
        kind: "positional",
        default: null,
        doc: fieldDoc(parsed, entry.name, field.name, documentedFields),
        fields: [],
      })),
    };
  });

  // Every documented field has to belong to an argument that has it: a `# Arguments` line naming a
  // field that was renamed reads perfectly and tells a model to write something the call refuses.
  for (const entry of documented_) {
    const dot = entry.name.indexOf(".");
    if (dot < 0) continue;
    const owner = entry.name.slice(0, dot);
    const field = entry.name.slice(dot + 1);
    const parameter = parameters.find((candidate) => candidate.name === owner);
    if (
      parameter === undefined ||
      !parameter.fields.some((candidate) => candidate.name === field)
    ) {
      throw new Error(
        `${parsed.what} documents \`${entry.name}\`, which is not a field of any argument`,
      );
    }
  }

  return {
    shape: {
      signature: `${name} :: ${renderType(type, optional)}`,
      parameters,
    },
    returned: rest,
    // The return position as a model reads it, which is what decides whether the declaration owes a
    // `# Returns` section: everything here is in `Effect`, so `Effect Unit` is the whole of "hands
    // nothing back" and anything else hands something back.
    returnedText: renderType(rest, optional),
  };
}

/** One field's documentation, or a failure naming the field nobody described. */
function fieldDoc(parsed, parameter, field, documented_) {
  const found = documented_.find((entry) => entry.name === field);
  if (found === undefined) {
    throw new Error(
      `${parsed.what} takes \`${parameter}.${field}\` and does not document it; ` +
        "a record argument needs a `- `argument.field` — what it is for` line per field",
    );
  }
  return brieflyDocumented(parsed, found);
}

/**
 * A call that hands something back says what, and a call that hands nothing back says nothing.
 *
 * Both halves matter. The first is the completeness rule the `# Returns` section exists for: a
 * signature ending in a type is a value the program is about to work with, and `Effect
 * Gg.Context.ReclaimReport` names the type without saying which of its numbers answers the question
 * that was asked. The second stops the section from becoming a ritual — `Effect Unit` is already the
 * whole answer, and a line saying so would be the unnecessary words the register forbids.
 *
 * It is checked here, at the declaration, rather than left to a count somebody takes later: the
 * defect this catches is an authored sentence with no destination, and a reflector that silently
 * drops one is the exact failure mode two other arms on this project shipped.
 */
function requireReturnDoc(parsed, returnedText) {
  const documented_ = parsed.sections.has("Returns");
  const hands = returnedText !== "Effect Unit";
  if (hands && !documented_) {
    throw new Error(
      `${parsed.what} hands back \`${returnedText}\` and has no \`# Returns\` section; a model ` +
        "reading the type still has to be told which part of the value answers the question",
    );
  }
  if (!hands && documented_) {
    throw new Error(
      `${parsed.what} hands nothing back and writes a \`# Returns\` section; \`Effect Unit\` is ` +
        "the whole answer, and a line restating it is words a reader pays for and learns nothing from",
    );
  }
}

/** One catalogued call: what it binds, how it is written, what it says, and the types it reaches. */
function describe(module_, name) {
  const declaration = value(module_.path, name);
  const fqn = `${module_.path}.${name}`;
  const parsed = comment(declaration, `\`${fqn}\``);
  const { shape, returned, returnedText } = shapeOf(
    module_.path,
    declaration,
    name,
    parsed,
  );
  requireReturnDoc(parsed, returnedText);
  const { brief, detail } = documented(parsed);

  // The WHOLE declared type, constraints included, rather than the arguments the shape peeled out of
  // it: an optional-argument record is `Record given` with a `Union given rest UpdateTaskOptions`
  // constraint beside it, so the row naming `Gg.Tasks.TaskStatus` is in the constraint and nowhere
  // else. Walking the peeled arguments alone left two types documented and unreachable.
  const reached = mentions(declaration.info.type);
  const returnMentions = mentions(returned);

  return {
    ...operationOf(parsed, module_),
    module: module_.id,
    // `function` on every entry, alias or not. A value on this arm carries no behaviour — a record
    // has fields and nothing else — so the second way to reach an operation is a free function over
    // the value rather than a member on it, which is the equivalent shape rather than a shortfall.
    kind: "function",
    receiver: null,
    name,
    fqn,
    // `null`, because the fully-qualified name IS what a program writes: a module is imported under
    // its own full name, so `Gg.Files.readFile` is the key and the call site at once.
    call: null,
    brief,
    detail,
    signatures: [shape],
    types: references(
      closure([...reached, ...returnMentions, ...ALWAYS_REFERENCED]),
    ),
    returns: references(returnMentions),
    // The failure this declaration's own `# Throws` section declares, beside the sentence that
    // declares it rather than instead of it: the section goes on being folded into the detail
    // verbatim, and this is the structured list a `docViewTypes` `errors` flag opens a view from.
    throws: declaredFailures(parsed),
  };
}

// ---------------------------------------------------------------------------------------------
// The types
// ---------------------------------------------------------------------------------------------

/** One catalogued type: its declaration, what it is for, and a line per member. */
function describeType(fqn) {
  const { module: module_, name, declaration } = DECLARED.get(fqn);
  const parsed = comment(declaration, `the type \`${fqn}\``);
  const { brief, detail } = documented(parsed);
  const members =
    declaration.info.declType === "data"
      ? dataMembers(name, declaration)
      : synonymMembers(fqn, declaration, parsed);
  const rendered =
    declaration.info.declType === "data"
      ? `data ${name} = ${members
          .map((member) =>
            member.type === null
              ? member.name
              : `${member.name} ${member.type}`,
          )
          .join(" | ")}`
      : `type ${name} = { ${members
          .map((member) => `${member.name} :: ${member.type}`)
          .join(", ")} }`;
  return {
    fqn,
    module: module_.id,
    name,
    declaration: rendered,
    brief,
    detail,
    members,
    // Empty on every type this SDK declares, and by design rather than by omission: a value here
    // carries no behaviour, and every capability another arm hangs off a value is a free function
    // over that value instead. A member on a record is a field access no search can reach, which is
    // the same failure an API object was.
    memberFunctions: [],
  };
}

/** A `data` type: its arms are its members, each documented on the constructor itself. */
function dataMembers(name, declaration) {
  const arms = (declaration.children ?? []).filter(
    (child) => child.info.declType === "dataConstructor",
  );
  return arms.map((arm) => {
    const carried = arm.info.arguments ?? [];
    if (carried.length > 1)
      throw new Error(`${name}.${arm.title} carries more than one value`);
    const parsed = comment(arm, `\`${name}.${arm.title}\``);
    const { brief, detail } = documented(parsed);
    return {
      name: arm.title,
      type: carried.length === 0 ? null : renderType(carried[0], new Map()),
      kind: "variant",
      brief,
      detail,
    };
  });
}

/** A record synonym: its fields are its members, documented under `# Fields`. */
function synonymMembers(fqn, declaration, parsed) {
  const row = recordRow(declaration.info.type);
  const fields = recordFields(row, new Map());
  const documented_ = entries(parsed, "Fields");
  const members = fields.map((field) => {
    const found = documented_.find((entry) => entry.name === field.name);
    if (found === undefined) {
      throw new Error(
        `${fqn} has a field \`${field.name}\` its \`# Fields\` list does not describe`,
      );
    }
    const [brief, ...rest] = found.paragraphs;
    const detail = rest.join("\n\n");
    return {
      name: field.name,
      type: field.type,
      kind: "field",
      brief,
      detail: detail === "" ? null : detail,
    };
  });
  for (const entry of documented_) {
    if (!fields.some((field) => field.name === entry.name)) {
      throw new Error(
        `${fqn} describes a field \`${entry.name}\` it does not have`,
      );
    }
  }
  return members;
}

// ---------------------------------------------------------------------------------------------
// The libraries
// ---------------------------------------------------------------------------------------------

/**
 * The libraries a program may import, grouped as `spago.yaml` groups them and named as a program
 * must write them: module names, read out of the library tree that actually shipped.
 *
 * A package `spago.yaml` declares and the tree does not carry is a failure here, because the
 * alternative is a prompt telling a model to import something that is not there — which is the exact
 * failure this section exists to prevent, and which the Python arm shipped once.
 *
 * `.Internal` modules are left out. They are in the tree and a program that imports one compiles,
 * but they are a library's own plumbing rather than its surface, and a list is read by a model
 * choosing what to reach for.
 */
function libraries() {
  const source = readFileSync(join(PACKAGE, "spago.yaml"), "utf8");
  const groups = [];
  for (const line of source.split("\n")) {
    const heading = /^\s*# --- (.+?) ---\s*$/u.exec(line);
    if (heading !== null) {
      groups.push({ group: heading[1], packages: [] });
      continue;
    }
    const dependency = /^\s+- ([a-z0-9-]+)\s*$/u.exec(line);
    if (dependency !== null && groups.length > 0) {
      groups[groups.length - 1].packages.push(dependency[1]);
    }
  }
  if (groups.length === 0)
    throw new Error("spago.yaml declares no `# --- group ---` headings");

  const staged = readdirSync(join(TREE_DIR, "libs"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return groups.map((group) => ({
    group: group.group,
    modules: group.packages
      .flatMap((name) => {
        const directory = staged.find((candidate) =>
          candidate.startsWith(`${name}-`),
        );
        if (directory === undefined) {
          throw new Error(
            `spago.yaml declares \`${name}\` and the built library tree does not carry it; ` +
              "re-cut the tree with build.sh (cargo clean -p gg-artifact-purescript forces it)",
          );
        }
        return modulesUnder(join(TREE_DIR, "libs", directory, "src"));
      })
      .filter((module_) => !module_.includes(".Internal"))
      .sort(),
  }));
}

/** Every module declared by the `.purs` files under `directory`, read from their own headers. */
function modulesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...modulesUnder(path));
      continue;
    }
    if (!entry.name.endsWith(".purs")) continue;
    const header = /^module\s+([\w.']+)/mu.exec(readFileSync(path, "utf8"));
    if (header === null) throw new Error(`${path} has no module header`);
    found.push(header[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/** Each module's own brief, detail and import line, out of its `-- |` header. */
function modulesSection() {
  return MODULES.map((module_) => {
    const docs = moduleDocs(module_.path);
    const parsed = {
      prose: unwrap((docs.comments ?? "").split("\n")),
      sections: new Map(),
      what: `the \`${module_.path}\` module`,
    };
    const { brief, detail } = documented(parsed);
    return {
      id: module_.id,
      path: module_.path,
      brief,
      detail,
      // The one arm that writes a real import line, and it is the module's own name on both sides:
      // an alias of the full path is what makes `Gg.Files.readFile` — the key a documentation view
      // is opened by — an expression the program can write as it stands.
      import: `import ${module_.path} as ${module_.path}`,
    };
  });
}

/**
 * Every catalogued call, module by module.
 *
 * The `Gg.Core` module binds nothing and is the only one allowed to: it declares the two failure
 * types and the three helpers that read a failure. Every other module's exported values are all
 * bound operations, which is the reverse check that stops a capability from being exported,
 * compiled, documented for a human reader and invisible to every model.
 */
function functionsSection() {
  const functions = [];
  const bound = new Map();
  const aliases = [];
  for (const module_ of MODULES) {
    const capabilities = [...moduleDocs(module_.path).values.keys()];
    if (module_.id === CORE) continue;
    if (capabilities.length === 0) {
      throw new Error(
        `${module_.path} exports no capability at all; is it a module or plumbing?`,
      );
    }
    for (const name of capabilities) {
      const entry = describe(module_, name);
      // Only a CANONICAL binding claims an operation. An alias is by definition a second way to
      // reach one that is already bound, so it is the one entry allowed to name an operation
      // somebody else named — and the check below is that it names one that really is bound, which
      // is what stops `# Alias` from being a way to smuggle in an operation this arm covers nowhere.
      if (entry.aliasOf !== null) {
        aliases.push(entry);
        functions.push(entry);
        continue;
      }
      const claimed = bound.get(entry.operation);
      if (claimed !== undefined) {
        throw new Error(
          `\`${claimed}\` and \`${entry.fqn}\` both bind the operation \`${entry.operation}\``,
        );
      }
      bound.set(entry.operation, entry.fqn);
      functions.push(entry);
    }
  }
  for (const alias of aliases) {
    if (!bound.has(alias.aliasOf)) {
      throw new Error(
        `\`${alias.fqn}\` is an alias of \`${alias.aliasOf}\`, which this arm binds nowhere; an ` +
          "alias is a second way to reach an operation, so one standing alone leaves the operation " +
          "uncovered and itself gated by something the arm does not offer",
      );
    }
  }
  return functions;
}

/** Every catalogued type, in the order the modules present them. */
function typesSection() {
  return [...DECLARED.keys()].map(describeType);
}

/** The whole catalogue. */
function catalogue() {
  const functions = functionsSection();
  const types = typesSection();
  return {
    schema: SCHEMA,
    language: "purescript",
    generatedFrom: GENERATED_FROM,
    libraries: libraries(),
    modules: modulesSection(),
    functions,
    types,
  };
}

// The destination is a build directory rather than a checked-out one, so it may not exist yet —
// and failing on a missing parent after twenty seconds of `purs` would be a poor way to say so.
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(catalogue(), null, "\t")}\n`);
console.log(`wrote ${basename(OUT)}`);
