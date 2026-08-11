// Emit the signature catalogue gg documents this arm's surface from.
//
// gg has to be able to tell a model what a function it found does, and every word of that answer is
// REFLECTED out of the SDK's own emitted declarations rather than written in a prompt template. In a
// `.d.ts` the declaration *is* the signature and the JSDoc beside it is already written for the
// audience that will read it, so the two cannot drift; a hand-written list would drift silently, and
// a model shown a signature the sandbox does not have wastes a whole turn discovering it.
//
// The pipeline, all of which `packages/gg-sandbox/build.sh` runs in order:
//
//   src/gg/*.ts  --tsc-->  dist/headers/gg/*.d.ts
//                --this script-->  crates/gg/src/sandbox/guests/<language-id>.signatures.json
//
// and `crates/gg/src/sandbox/language/{typescript,javascript}.rs` embed that JSON with
// `include_str!`. Because the same `build.sh` invocation also rebuilds the component, the
// documentation can never be more current than the component that implements it — the correct
// failure direction.
//
// It emits TWO catalogues from one set of declarations, because gg's TypeScript and JavaScript arms
// ARE one set of declarations: the same guest, the same SDK, the same signatures, and one difference
// — whether gg type-checks the program before evaluating it. See `LANGUAGES` below.
//
// # What the shape is
//
// Schema 2, the normalized doc model: **modules** rather than API objects, one flat **functions**
// array whose entries name a gg **operation** and are keyed by a module-qualified **fqn**, an
// **authored** brief and optional detail rather than a derived summary, and type references
// **resolved** to the declaration each one opens.
//
//   * a module is `src/gg/<id>.ts`, and its own file-leading JSDoc is what introduces it;
//   * a function is an exported function of one of those files, and the gg operation it binds is
//     written ON the declaration as `@ggop <namespace>.<key>` — never in a table beside it, because a
//     table is a second place to be wrong;
//   * a type is an exported interface, type alias or class of one of those files, and it belongs to
//     the module that declares it, so two modules are free to declare a type of one name;
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
//   node tools/signatures.mjs --out-dir <dir>          # write one catalogue per language
//   node tools/signatures.mjs --out-dir <dir> --check  # verify the committed catalogues are current
//
// `--check` is the local rehearsal of the CI drift gate, which regenerates the file and fails on any
// `git diff`.

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
 * the stem its committed artifacts are filed at.
 *
 * The id is written into the catalogue so a committed artifact says whose spellings it carries, and
 * is asserted by the host against the language that embedded it — a catalogue filed under the wrong
 * stem is then a load-time failure rather than documentation describing a sandbox nobody has.
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

/** The doc model this catalogue is written in. See the header. */
const SCHEMA = 2;

/**
 * The provenance string written into the catalogue, so a reader of the JSON knows it is generated and
 * where from.
 */
const GENERATED_FROM = "packages/gg-sandbox/src/gg/ (tsc, declaration emit)";

/** The JSDoc tag that names the gg operation a declaration binds. */
const OPERATION_TAG = "ggop";

/** The JSDoc tag that marks a declaration as this package's business rather than a model's. */
const INTERNAL_TAG = "internal";

/**
 * The type every signature reaches whether it names it or not.
 *
 * Every function on this surface throws it, and no signature says so, because TypeScript has no
 * checked exceptions. Folding it into each entry's closure is what makes a documentation view of any
 * call carry the type its failure arrives as.
 */
const ALWAYS_REFERENCED = "ToolError";

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
 * The rule is the model's: a summary line, then a blank line, then the rest. It is enforced here
 * rather than in a gate over the emitted JSON because here is where the author is standing — a first
 * paragraph that wraps over two lines is a mistake to be told about at the declaration, not three
 * steps later under a name the author has to go looking for.
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
 * so this script depends only on what `tsconfig.headers.json` emits — which is what lets CI run the
 * drift gate without ever building the JavaScript the component is made from.
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
  const {
    ALWAYS_BOUND,
    ENDING_BOUND,
    LIBRARY_BOUND,
    MODULE_ORDER,
    SURFACE,
    TOOL_BOUND,
    exportedName,
    keyOf,
    moduleOf,
  } = catalogue;

  // Every operation gg's binding tables say this arm offers. It is the *other* direction of the
  // `@ggop` check: a declaration that names no operation is caught below, and an operation nothing
  // declares is caught against this set, which is the failure that would otherwise cost a whole
  // capability with nothing to see in a diff.
  const expected = new Set([
    ...Object.keys(TOOL_BOUND),
    ...ALWAYS_BOUND,
    ...LIBRARY_BOUND,
    ...Object.keys(ENDING_BOUND),
  ]);

  const modules = [];
  const declared = [];
  /** @type {{ id: string, name: string, fqn: string, operation: string, nodes: any[], sourceFile: any }[]} */
  const found = [];

  for (const id of MODULE_ORDER) {
    const sourceFile = await loadModule(id);
    const path = `${SURFACE}.${id}`;
    const prose = moduleProse(sourceFile, `the module \`${path}\``);
    modules.push({
      id,
      path,
      brief: prose.brief,
      detail: prose.detail,
      // `null`, and honestly: gg binds this SDK into a program's scope, so a documented import would
      // be a line a model would be wrong to think it had to write.
      import: null,
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
        declared.push({
          module: id,
          name,
          fqn,
          declaration: declarationText(statement, sourceFile),
          brief: prose.brief,
          detail: prose.detail,
          members: typeMembers(statement, sourceFile, fqn),
          memberFunctions: [],
        });
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
    const prose = documentation(entry.nodes[0], entry.sourceFile, where);
    const signatures = signaturesOf(entry.nodes, entry.sourceFile, entry.name, where);
    const returned = entry.nodes[0].type ? print(entry.nodes[0].type, entry.sourceFile) : "void";
    const written = signatures.flatMap((shape) => shape.parameters.map((p) => p.type));
    const types = resolver.closure(returned, ...written, ALWAYS_REFERENCED);
    for (const reference of types) reached.add(reference.fqn);
    functions.push({
      operation: entry.operation,
      // This SDK offers each operation exactly once: an exported module function is the whole of the
      // idiom, so there is no second way to reach one and nothing is an alias.
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
      `${JSON.stringify(missing)} are operations this arm's binding tables say it offers and no ` +
        `declaration binds. Write \`@${OPERATION_TAG} <id>\` on the function that implements each, ` +
        "or take the row out of src/catalogue.ts.",
    );
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

/** Parse the command line, rejecting anything it does not understand rather than guessing. */
function parseArguments(argv) {
  let outDir;
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out-dir") {
      outDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--check") {
      check = true;
    } else {
      throw new Error(`unknown argument \`${argv[i]}\`; usage: --out-dir <dir> [--check]`);
    }
  }
  if (!outDir) throw new Error("--out-dir <dir> is required; usage: --out-dir <dir> [--check]");
  return { outDir: path.resolve(outDir), check };
}

async function main() {
  const { outDir, check } = parseArguments(process.argv.slice(2));
  for (const language of LANGUAGES) {
    const out = path.join(outDir, `${language}.signatures.json`);
    const catalogue = await build(language);
    if (check) {
      const committed = await readFile(out, "utf8").catch(() => "");
      if (committed !== catalogue) {
        throw new Error(
          `${path.relative(process.cwd(), out)} is stale. Regenerate it with ` +
            "`npm run -w @test-cabinet/gg-sandbox signatures` and commit the result.",
        );
      }
      process.stdout.write(`${path.relative(process.cwd(), out)} is up to date.\n`);
      continue;
    }
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
