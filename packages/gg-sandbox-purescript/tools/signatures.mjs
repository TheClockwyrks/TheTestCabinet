/**
 * Emit the COMMITTED signature catalogue for the PureScript arm:
 *
 *   packages/gg-sandbox-purescript/src/Gg/**  --this script-->  crates/gg/src/sandbox/guests/purescript.signatures.json
 *   packages/gg-sandbox-purescript/spago.yaml                -->  its `libraries` section
 *
 * gg renders the responses-as-code system prompt and every documentation view from that file, so it
 * is the whole of what a model is *told* about this arm's surface — and every word of it is
 * reflected out of the declaration it describes rather than written anywhere else. A description
 * kept in a table, a template or a `const` in gg's Rust is a description that drifts from its
 * subject with nothing to catch it.
 *
 * # It reads `purs`, which is what a PureScript author already writes
 *
 * `purs compile --codegen docs` emits a `docs.json` per module carrying every exported declaration's
 * doc comment and its full type. So a signature here is the compiler's own reading of the SDK, not a
 * second copy of it, and a renamed argument or a changed type shows up as a diff in the committed
 * catalogue rather than as a sentence that quietly stopped being true.
 *
 * # The one thing PureScript does not have, and the convention that replaces it
 *
 * There is no per-parameter documentation slot in this language — a type says `String -> Int ->
 * Effect Unit` and names nothing — and `purs` discards a comment written on a record field in all
 * three placements it might go. So both are written as a `# Arguments` (or `# Fields`) list in the
 * declaration's own doc comment, exactly as Rust's `# Arguments` convention does it, and this script
 * is what turns them into structure. The completeness rules below are what stop the convention from
 * being decoration:
 *
 *   * a signature that takes N arguments must document N, in order;
 *   * every field of a record argument must be documented, and every documented field must exist;
 *   * a `# Fields` list must name every field of the type it is on, and only those;
 *   * nothing may be blank.
 *
 * Each of those is a `throw` here rather than a `null` in the JSON, because the
 * [agreement gate](../../../apps/docs/src/content/docs/gg/program-languages.md) fails a catalogue
 * with a blank in it and the failure would otherwise land on a model reading a signature it cannot
 * act on.
 *
 * # Usage
 *
 *   packages/gg-sandbox-purescript/signatures.sh
 *
 * which unpacks the committed library tree, stages this package's `src/` into it, and compiles the
 * lot with `--codegen docs` first. `scripts/ci/contract-drift.sh` runs that script and fails on any
 * diff, so an edit to a doc comment without a regeneration is an error rather than a surprise.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELPERS,
  META,
  OBJECTS,
  PROGRAMS,
  SESSION,
  TOOLS,
  TYPE_MODULES,
  VIEWS,
  moduleFor,
} from "./catalogue.mjs";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");
const OUT = join(ROOT, "crates", "gg", "src", "sandbox", "guests", "purescript.signatures.json");

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
    const document = JSON.parse(readFileSync(join(DOCS_DIR, entry.name, "docs.json"), "utf8"));
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
    modules.set(entry.name, { values, types, order });
  }
  return modules;
}

const MODULES = loadModules();

/** One module's documented declarations, or a failure naming the module nobody compiled. */
function moduleDocs(name) {
  const found = MODULES.get(name);
  if (found === undefined) {
    throw new Error(`\`purs\` documented no module called ${name}; is it in src/ and exported?`);
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

/** One exported type declaration, wherever in the SDK it is declared. */
function typeDeclaration(name) {
  for (const module_ of TYPE_MODULES) {
    const found = moduleDocs(module_).types.get(name);
    if (found !== undefined) return found;
  }
  return undefined;
}

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
  return { module: path.join("."), name };
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

/** One type, as PureScript writes it. `optional` resolves a row variable to the row it stands for. */
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
  if (type.tag === "TypeConstructor") return constructor_(type).name;
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
 * [TypeScript's](../../../crates/gg/src/sandbox/guests/typescript.signatures.json) own catalogue
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
  if (tail.tag !== "TypeVar") throw new Error(`this script cannot print a ${tail.tag} row tail`);
  const resolved = optional.get(tail.contents);
  if (resolved === undefined) {
    throw new Error(`the row variable \`${tail.contents}\` is not bound by a Union constraint`);
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
    throw new Error("a Union constraint's first argument must be the row variable it constrains");
  }
  optional.set(variable.contents, resolveRow(row));
}

/** The fields of an optional row, whether written inline or behind a row synonym. */
function resolveRow(node) {
  const named = constructor_(node);
  if (named === undefined) return rowFields(node).fields;
  const declaration = moduleDocs(named.module).types.get(named.name);
  if (declaration === undefined || declaration.info.declType !== "typeSynonym") {
    throw new Error(`${named.module}.${named.name} is not a row synonym this script can resolve`);
  }
  return rowFields(declaration.info.type).fields;
}

/** Every type this SDK declares that `node` mentions, transitively closed. */
function referencedTypes(node, found = []) {
  const walk = (value_) => {
    if (Array.isArray(value_)) {
      for (const item of value_) walk(item);
      return;
    }
    if (value_ === null || typeof value_ !== "object") return;
    const named = constructor_(value_);
    if (named !== undefined && TYPE_MODULES.includes(named.module) && !found.includes(named.name)) {
      found.push(named.name);
      const declaration = typeDeclaration(named.name);
      if (declaration !== undefined) {
        referencedTypes(declaration.info.type ?? {}, found);
        for (const child of declaration.children ?? []) {
          referencedTypes(child.info.arguments ?? [], found);
        }
      }
    } else if (named !== undefined && named.module.startsWith("Gg.")) {
      // A row synonym — `UpdateTaskOptions` — is not itself a type a model reads, but the types its
      // fields are typed by are: without following it, `status :: TaskStatus` would reach a model as
      // a name nothing in the catalogue declares.
      const row = MODULES.get(named.module)?.types.get(named.name);
      if (row !== undefined && row.info.declType === "typeSynonym") {
        referencedTypes(row.info.type, found);
      }
    }
    for (const nested of Object.values(value_)) walk(nested);
  };
  walk(node);
  return found;
}

// ---------------------------------------------------------------------------------------------
// The doc comment
// ---------------------------------------------------------------------------------------------

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
  if (fence !== null) throw new Error("a doc comment has an unterminated code fence");
  return blocks.join("\n\n").trim();
}

/** One `- \`name\` — description` list, as an ordered list of entries. */
function entries(parsed, heading) {
  const lines = parsed.sections.get(heading);
  if (lines === undefined) {
    throw new Error(`${parsed.what} has no \`# ${heading}\` section`);
  }
  const found = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const item = /^- `([^`]+)` — (.*)$/u.exec(line);
    if (item !== null) {
      found.push({ name: item[1], doc: item[2].trim() });
      continue;
    }
    if (/^\s+\S/u.test(line) && found.length > 0) {
      found[found.length - 1].doc = `${found[found.length - 1].doc} ${line.trim()}`;
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
  for (const entry of found) {
    if (entry.doc === "") throw new Error(`${parsed.what} documents \`${entry.name}\` with nothing`);
  }
  return found;
}

/** The section that says what a call raises, folded into the doc the way every other arm folds it. */
function raises(parsed) {
  const lines = parsed.sections.get("Raises");
  if (lines === undefined) return undefined;
  const text = lines.join("\n").trim();
  if (text === "") throw new Error(`${parsed.what} has an empty \`# Raises\` section`);
  return text.replace(/\n\s*/gu, " ");
}

// ---------------------------------------------------------------------------------------------
// One function
// ---------------------------------------------------------------------------------------------

/**
 * One catalogued function: its signature as `purs` reads it, its arguments as the `# Arguments`
 * convention names them, its documentation, and the types it refers to.
 */
function describe(module_, name) {
  const declaration = value(module_, name);
  const what = `${module_}.${name}`;
  const parsed = comment(declaration, what);
  const { type, optional } = peel(declaration.info.type);

  const argumentTypes = [];
  let rest = type;
  for (;;) {
    const split = arrow(rest);
    if (split === undefined) break;
    argumentTypes.push(split.argument);
    rest = bare(split.result);
  }

  const documented = entries(parsed, "Arguments");
  const top = documented.filter((entry) => !entry.name.includes("."));
  if (top.length !== argumentTypes.length) {
    throw new Error(
      `${what} takes ${argumentTypes.length} arguments and documents ${top.length}; ` +
        "every argument needs a `- `name` — what it is for` line, in order",
    );
  }

  const parameters = top.map((entry, index) => {
    const node = argumentTypes[index];
    const row = recordRow(node);
    const fields = row === undefined ? [] : recordFields(row, optional);
    const documentedFields = documented
      .filter((candidate) => candidate.name.startsWith(`${entry.name}.`))
      .map((candidate) => ({ ...candidate, name: candidate.name.slice(entry.name.length + 1) }));
    return {
      name: entry.name,
      type: renderType(node, optional),
      optional: false,
      kind: "positional",
      default: null,
      doc: entry.doc,
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        optional: field.optional,
        kind: "positional",
        default: null,
        doc: fieldDoc(what, entry.name, field.name, documentedFields),
        fields: [],
      })),
    };
  });

  // Every documented field has to belong to an argument that has it: a `# Arguments` line naming a
  // field that was renamed reads perfectly and tells a model to write something the call refuses.
  for (const entry of documented) {
    const dot = entry.name.indexOf(".");
    if (dot < 0) continue;
    const owner = entry.name.slice(0, dot);
    const field = entry.name.slice(dot + 1);
    const parameter = parameters.find((candidate) => candidate.name === owner);
    if (parameter === undefined || !parameter.fields.some((candidate) => candidate.name === field)) {
      throw new Error(`${what} documents \`${entry.name}\`, which is not a field of any argument`);
    }
  }

  const raised = raises(parsed);
  const types = referencedTypes(declaration.info.type);
  if (raised !== undefined) referencedTypes(errorType(), types);

  return {
    name,
    signatures: [
      {
        signature: `${name} :: ${renderType(type, optional)}`,
        parameters,
      },
    ],
    doc: raised === undefined ? parsed.prose : `${parsed.prose}\n\nRaises \`ToolError\`: ${raised}`,
    types,
  };
}

/** The `ToolError` declaration, as a type node, so a raising function pulls it into its types. */
function errorType() {
  return { tag: "TypeConstructor", contents: [["Gg", "Error"], "ToolError"] };
}

/** One field's documentation, or a failure naming the field nobody described. */
function fieldDoc(what, parameter, field, documented) {
  const found = documented.find((entry) => entry.name === field);
  if (found === undefined) {
    throw new Error(
      `${what} takes \`${parameter}.${field}\` and does not document it; ` +
        "a record argument needs a `- `argument.field` — what it is for` line per field",
    );
  }
  return found.doc;
}

// ---------------------------------------------------------------------------------------------
// The types
// ---------------------------------------------------------------------------------------------

/** One catalogued type: its declaration, what it is for, and a line per member. */
function describeType(name) {
  const declaration = typeDeclaration(name);
  if (declaration === undefined) throw new Error(`no SDK module declares the type ${name}`);
  const parsed = comment(declaration, name);
  return declaration.info.declType === "data"
    ? describeData(name, declaration, parsed)
    : describeSynonym(name, declaration, parsed);
}

/** A `data` type: its arms are its members, each documented on the constructor itself. */
function describeData(name, declaration, parsed) {
  const arms = (declaration.children ?? []).filter(
    (child) => child.info.declType === "dataConstructor",
  );
  const members = arms.map((arm) => {
    const carried = arm.info.arguments ?? [];
    if (carried.length > 1) throw new Error(`${name}.${arm.title} carries more than one value`);
    return {
      name: arm.title,
      type: carried.length === 0 ? null : renderType(carried[0], new Map()),
      doc: comment(arm, `${name}.${arm.title}`).prose,
    };
  });
  const rendered = members.map((member) =>
    member.type === null ? member.name : `${member.name} ${member.type}`,
  );
  return {
    name,
    declaration: `data ${name} = ${rendered.join(" | ")}`,
    doc: parsed.prose,
    members,
  };
}

/** A record synonym: its fields are its members, documented under `# Fields`. */
function describeSynonym(name, declaration, parsed) {
  const row = recordRow(declaration.info.type);
  if (row === undefined) throw new Error(`${name} is a type synonym this catalogue cannot describe`);
  const fields = recordFields(row, new Map());
  const documented = entries(parsed, "Fields");
  const members = fields.map((field) => {
    const found = documented.find((entry) => entry.name === field.name);
    if (found === undefined) {
      throw new Error(`${name} has a field \`${field.name}\` its \`# Fields\` list does not describe`);
    }
    return { name: field.name, type: field.type, doc: found.doc };
  });
  for (const entry of documented) {
    if (!fields.some((field) => field.name === entry.name)) {
      throw new Error(`${name} describes a field \`${entry.name}\` it does not have`);
    }
  }
  const rendered = members.map((member) => `${member.name} :: ${member.type}`);
  return {
    name,
    declaration: `type ${name} = { ${rendered.join(", ")} }`,
    doc: parsed.prose,
    members,
  };
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
  if (groups.length === 0) throw new Error("spago.yaml declares no `# --- group ---` headings");

  const staged = readdirSync(join(TREE_DIR, "libs"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return groups.map((group) => ({
    group: group.group,
    modules: group.packages
      .flatMap((name) => {
        const directory = staged.find((candidate) => candidate.startsWith(`${name}-`));
        if (directory === undefined) {
          throw new Error(
            `spago.yaml declares \`${name}\` and the committed library tree does not carry it; ` +
              "rebuild the tree with build.sh",
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

/** Every function the identity table names, described from the module that declares it. */
function catalogue() {
  const objects = OBJECTS.map((entry) => ({
    object: entry.object,
    doc: comment(value(entry.module, entry.object), `${entry.module}.${entry.object}`).prose,
  }));

  const meta = META.map((entry) => ({
    key: entry.key,
    ...describe(entry.module, entry.name),
  }));
  const session = SESSION.map((entry) => ({
    key: entry.key,
    ending: entry.ending,
    object: entry.object,
    ...describe(moduleFor(entry.object), entry.name),
  }));
  const views = VIEWS.map((entry) => ({
    key: entry.key,
    requires: entry.requires ?? null,
    object: entry.object,
    ...describe(moduleFor(entry.object), entry.name),
  }));
  const programs = PROGRAMS.map((entry) => ({
    key: entry.key,
    object: entry.object,
    ...describe(moduleFor(entry.object), entry.name),
  }));
  const tools = TOOLS.map((entry) => ({
    tool: entry.tool,
    object: entry.object,
    ...describe(moduleFor(entry.object), entry.name),
  }));
  const helpers = HELPERS.map((entry) => ({
    key: entry.key,
    requires: entry.requires,
    object: entry.object,
    ...describe(moduleFor(entry.object), entry.name),
  }));

  const referenced = new Set();
  for (const entry of [...meta, ...session, ...views, ...programs, ...tools, ...helpers]) {
    for (const name of entry.types) referenced.add(name);
  }
  const types = TYPE_MODULES.flatMap((module_) => moduleDocs(module_).order)
    .filter((name) => referenced.has(name))
    .map(describeType);

  // Every function this SDK's objects offer has to be catalogued, or a model is shown a surface
  // narrower than the one it has. The object records are the surface, so they are what is compared.
  catalogued(objects, [...session, ...views, ...programs, ...tools, ...helpers], meta);

  return {
    language: "purescript",
    generatedFrom: "packages/gg-sandbox-purescript/src/Gg/ + spago.yaml (purs --codegen docs)",
    libraries: libraries(),
    objects,
    meta,
    session,
    views,
    programs,
    tools,
    helpers,
    types,
  };
}

/**
 * Every field of every API object record is either catalogued or the meta function, and every
 * catalogued function is a field of the object it claims.
 *
 * This is the check that makes `catalogue.mjs` safe to be a hand-written table: it is identity data
 * with no run-time use in this language, so nothing but this would notice it drifting from the
 * modules it names.
 */
function catalogued(objects, functions, meta) {
  const metaNames = meta.map((entry) => entry.name);
  for (const object of objects) {
    const module_ = moduleFor(object.object);
    const row = recordRow(peel(value(module_, object.object).info.type).type);
    if (row === undefined) throw new Error(`${module_}.${object.object} is not a record of functions`);
    const offered = rowFields(row).fields.map((field) => field.label);
    const described = functions
      .filter((entry) => entry.object === object.object)
      .map((entry) => entry.name);
    for (const name of offered) {
      if (!described.includes(name) && !metaNames.includes(name)) {
        throw new Error(
          `\`${object.object}.${name}\` is offered by ${module_} and catalogued by nothing; ` +
            "add it to tools/catalogue.mjs",
        );
      }
    }
    for (const name of described) {
      if (!offered.includes(name)) {
        throw new Error(
          `tools/catalogue.mjs says \`${object.object}.${name}\` exists and ${module_} does not offer it`,
        );
      }
    }
  }
}

writeFileSync(OUT, `${JSON.stringify(catalogue(), null, "\t")}\n`);
console.log(`wrote ${basename(OUT)}`);
