// Emit the signature catalogue gg renders its system prompt from.
//
// gg has to tell a model, every turn, what functions its program may call and what they do. The
// wrong way to do that is a hand-written list in the prompt template: it drifts away from the SDK
// silently, and a model that is shown a signature the sandbox does not have wastes a whole turn
// discovering that. So the list is REFLECTED out of the SDK's own emitted declarations instead — in
// a `.d.ts` the declaration *is* the signature, and the JSDoc beside it is already written for the
// audience that will read it.
//
// The pipeline, all of which `packages/gg-sandbox/build.sh` runs in order:
//
//   src/**.ts  --tsc-->  dist/headers/**.d.ts
//              --this script-->  crates/gg/src/sandbox/guests/<language-id>.signatures.json
//
// and `crates/gg/src/sandbox/language/{typescript,javascript}.rs` embed that JSON with
// `include_str!`. Because the same `build.sh` invocation also rebuilds the component, the prompt can
// never be more current than the component that implements it — the correct failure direction.
//
// A catalogue is ONE LANGUAGE'S. gg's responses-as-code capability registers program languages, each
// with its own hand-written idiomatic SDK and its own committed
// `crates/gg/src/sandbox/guests/<language-id>.signatures.json` in this same shape. That is what the
// `language` field records, and what every non-tool entry's `key` is for: two languages offer the
// same surface and differ only in how a program spells it, so `key` is what their catalogues are
// compared on. A guest built by another toolchain need not run this script at all — only the
// emitted JSON is contractual.
//
// This script emits TWO of them from one set of declarations, because gg's TypeScript and JavaScript
// arms ARE one set of declarations: the same guest, the same SDK, the same signatures, and one
// difference — whether gg type-checks the program before evaluating it. See `LANGUAGES` below.
//
// Six properties are enforced here rather than left to review. Every one of them is the same rule
// under a different subject: NOTHING a model reads about this SDK may be written anywhere but on the
// declaration it describes, and an undocumented declaration is a build error rather than a blank in
// a prompt.
//
//   * every catalogued export must exist, in the module the catalogue names for it — a typo in
//     `src/catalogue.ts` is an error, not a missing prompt line;
//   * every catalogued export must carry a doc comment — an undocumented tool would reach a model as
//     a bare signature with nothing after the dash;
//   * every PARAMETER a catalogued signature declares must carry an `@param` describing it, and
//     every field of a parameter whose type is written inline must carry an `@param a.b` of its own;
//   * an `@param` that names something the signature does not declare is an error too, so a renamed
//     parameter cannot leave its description behind under the old name;
//   * every TYPE the catalogue carries must be documented, and so must each of its members — a
//     record whose fields arrive unexplained is a record a model has to guess at;
//   * every API OBJECT must carry the sentence the prompt introduces it by, taken from the doc
//     comment on its declaration in `src/catalogue.ts`.
//
// Beside its language tag and its provenance line the catalogue has eight parts — `objects`,
// `meta`, `session`, `views`, `programs`, `tools`, `helpers`, `types` — and after the objects the
// carve-outs come first because they are the parts that are not a projection of the run's enabled
// set: `list` is on every object whatever a run enables, an ending call is bound from the agent's
// *role*, three of the four view functions are bound unconditionally, and the program library is
// bound from a capability.
// So a run that offers no tools at all is still told how to end and how to put something in front of
// itself.
//
// `meta` is the one section whose entries carry no `object`, because `list` is seeded onto EVERY
// object rather than declared on one. It is catalogued anyway, and for the reason the rest of this
// file exists: its signature and its description are read by a model, so they are reflected out of
// the declaration that states them rather than written into a host-side constant no gate compares.
//
// # One entry, many signatures
//
// A function's entry carries a `signatures` ARRAY rather than one string, because how a language
// offers an optional argument is that language's own business: Java writes two overloads where
// Kotlin writes one signature with a default and Python writes one with a keyword argument. All
// three are the same function — one entry, one `key`, one `object`, one description — and the array
// is what lets the shape differ without the identity differing. Each signature carries its own
// `parameters`, so an overload that takes fewer of them says so.
//
// TypeScript spells every optional argument with `?`, so every entry here has exactly one signature
// today. The overload group is still read, not assumed away: two declarations of one name in one
// module become one entry with two signatures.
//
// Usage:
//   node tools/signatures.mjs --out-dir <dir>          # write one catalogue per language
//   node tools/signatures.mjs --out-dir <dir> --check  # verify the committed catalogues are current
//
// `--check` is the local rehearsal of the CI drift gate, which regenerates the file and fails on any
// `git diff`.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
const HEADERS_DIR = path.join(PACKAGE_DIR, "dist", "headers");

/**
 * The gg program languages this guest implements: each one's `GgProgramLanguage` id, which is also
 * the stem its committed artifacts are filed at.
 *
 * The id is written into the catalogue so a committed artifact says whose spellings it carries, and
 * is asserted by the host against the language that embedded it — a catalogue filed under the wrong
 * stem is then a load-time failure rather than a system prompt describing a sandbox nobody has.
 *
 * There are TWO of them for one set of declarations, and that is the whole shape of gg's JavaScript
 * arm. `javascript` is `typescript` with the type check removed: the same component, the same SDK,
 * the same signatures — type annotations included, so a model on either arm reads exactly the same
 * surface — and the only difference is that gg does not run `tsc` over the program before evaluating
 * it. Emitting the catalogue twice under two ids is what lets the host embed one per language and
 * assert each is its own, without a hand-copied second file that could drift from the declarations
 * it was reflected out of.
 */
const LANGUAGES = ["typescript", "javascript"];

/**
 * The provenance string written into the catalogue, so a reader of the JSON knows it is generated
 * and where from.
 */
const GENERATED_FROM = "packages/gg-sandbox/src";

/** The one type declaration the catalogue always carries, whatever a run enables. */
const ALWAYS_INCLUDED_TYPE = "ToolError";

/**
 * Print a node without its comments and on one line.
 *
 * The printer is used rather than the raw source text because a type declaration's members carry
 * JSDoc that is written for a developer reading `src/types.ts`, while this output is read by a model
 * inside a system prompt — the declaration has to arrive as a declaration, not as a paragraph.
 */
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** @param {import("typescript").Node} node @param {import("typescript").SourceFile} sourceFile */
function print(node, sourceFile) {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, " ").trim();
}

/** The declaration text as the prompt shows it: no `export`/`declare` keywords, no trailing `;`. */
function declarationText(node, sourceFile) {
  return print(node, sourceFile)
    .replace(/^(?:export\s+)?(?:declare\s+)?/, "")
    .replace(/;$/, "");
}

/**
 * The declaration's own JSDoc, with its markers stripped and its lines joined onto one.
 *
 * Two blocks can end up attached to a declaration and only one of them describes it:
 *
 * - the *last* one is the declaration's own, which is why the last is the one taken;
 * - the *file's leading block* is the module header, and it gets attached to whatever declaration
 *   follows it once declaration emit has elided the type-only imports that stood in between. It is
 *   excluded explicitly, because otherwise an export whose doc was deleted would silently inherit
 *   its module's description and reach a model as a paragraph about the wrong thing — the exact
 *   failure this gate exists to prevent, made invisible.
 *
 * The text is collapsed onto one line because the prompt renders it as one bullet.
 */
function docComment(node, sourceFile) {
  const own = ownBlock(node, sourceFile);
  if (!own) return "";
  return (ts.getTextOfJSDocComment(own.comment) ?? "").replace(/\s+/g, " ").trim();
}

/** The JSDoc block that belongs to `node`, by the rule {@link docComment} describes. */
function ownBlock(node, sourceFile) {
  return ts
    .getJSDocCommentsAndTags(node)
    .filter((block) => ts.isJSDoc(block) && sourceFile.text.slice(0, block.pos).trim() !== "")
    .at(-1);
}

/**
 * The `@param` descriptions on a declaration, keyed by the name each one addresses.
 *
 * A field of an inline object argument is addressed the way JSDoc addresses one — `@param
 * options.offset` — so the key is the dotted path and the caller looks a field up under
 * `` `${parameter}.${field}` ``. That is deliberately the only way to document a field: a parameter
 * whose type is a NAMED type is documented on that type's members instead, so the same sentence can
 * never be written in two places.
 */
function paramDocs(node, sourceFile) {
  const own = ownBlock(node, sourceFile);
  /** @type {Map<string, string>} */
  const docs = new Map();
  for (const tag of own?.tags ?? []) {
    if (!ts.isJSDocParameterTag(tag)) continue;
    docs.set(
      tag.name.getText(sourceFile),
      (ts.getTextOfJSDocComment(tag.comment) ?? "").replace(/\s+/g, " ").trim(),
    );
  }
  return docs;
}

/**
 * The catalogue itself, read from `src/catalogue.ts`.
 *
 * The source file is transpiled in memory and imported as a data URL rather than read out of
 * `dist/`, so this script depends only on what `tsconfig.headers.json` emits — which is what lets CI
 * run the drift gate without ever building the JavaScript the component is made from.
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

/** Every `.d.ts` under `dist/headers`, parsed, sorted by path so the output order is stable. */
async function loadHeaders() {
  /** @type {string[]} */
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".d.ts")) files.push(full);
    }
  };
  await walk(HEADERS_DIR).catch(() => {
    throw new Error(
      `no declarations at ${HEADERS_DIR} — run \`tsc -p tsconfig.headers.json\` first ` +
        "(the `signatures` npm script does).",
    );
  });
  files.sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      sourceFile: ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.ES2022,
        /* setParentNodes */ true,
      ),
    })),
  );
}

/**
 * Index the declarations the catalogue can refer to.
 *
 * Functions are keyed by name and carry every declaration of that name in the file they came from —
 * an OVERLOAD GROUP is several declarations of one function, and becomes one catalogue entry with
 * several signatures. Two modules declaring one name is still an error: the shim binds by name into
 * a flat scope, so a collision there is one function silently shadowing another.
 *
 * Types keep their discovery order — files sorted, statements in source order — which is the order
 * the prompt lists them in, and carry the node they were read from so their members can be walked.
 *
 * Values are indexed too, because the API objects' descriptions are doc comments on the `OBJECT_*`
 * constants in `src/catalogue.ts`.
 */
function index(headers) {
  /** @type {Map<string, { nodes: any[]; sourceFile: any; file: string }>} */
  const functions = new Map();
  /** @type {Map<string, { declaration: string; doc: string; members: any[]; order: number }>} */
  const types = new Map();
  /** @type {Map<string, { value: string | undefined; doc: string }>} */
  const values = new Map();
  for (const { file, sourceFile } of headers) {
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = declaration.name?.text;
          if (!name) continue;
          values.set(name, {
            value: literalValue(declaration),
            doc: docComment(statement, sourceFile),
          });
        }
        continue;
      }
      const name = statement.name?.text;
      if (!name) continue;
      if (ts.isFunctionDeclaration(statement)) {
        const found = functions.get(name);
        if (found && found.file !== file) {
          throw new Error(`\`${name}\` is declared in two modules; SDK names must be unique.`);
        }
        if (found) found.nodes.push(statement);
        else functions.set(name, { nodes: [statement], sourceFile, file });
      } else if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)
      ) {
        types.set(name, {
          declaration: declarationText(statement, sourceFile),
          doc: docComment(statement, sourceFile),
          members: typeMembers(statement, sourceFile),
          order: types.size,
        });
      }
    }
  }
  return { functions, types, values };
}

/** The string a `declare const X = "…"` is fixed to, or `undefined` for anything else. */
function literalValue(declaration) {
  const node = declaration.initializer ?? declaration.type;
  if (node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return node.literal.text;
  }
  return node && ts.isStringLiteral(node) ? node.text : undefined;
}

/**
 * The members of one type declaration, each with the doc comment written on it.
 *
 * Three shapes reach a model and all three are walked. A record's members are its properties. A
 * union of string literals — `TaskStatus`, `AgentEnding` — has one member per arm, named by the
 * literal itself and carrying no type of its own, because the arm *is* the value. A union of records
 * — `FileRead` — contributes every arm's properties in order, so a discriminant appears once per arm
 * with the literal it is fixed to, which is exactly how a model reads the type.
 */
function typeMembers(statement, sourceFile) {
  if (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return propertyMembers(statement.members, sourceFile);
  }
  return ts.isTypeAliasDeclaration(statement) ? typeNodeMembers(statement.type, sourceFile) : [];
}

/** {@link typeMembers}, for one type *node* — the recursive half. */
function typeNodeMembers(node, sourceFile) {
  if (ts.isParenthesizedTypeNode(node)) return typeNodeMembers(node.type, sourceFile);
  if (ts.isTypeLiteralNode(node)) return propertyMembers(node.members, sourceFile);
  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((arm, index) =>
      ts.isLiteralTypeNode(arm)
        ? [{ name: print(arm, sourceFile), type: null, doc: armDoc(node, index, sourceFile) }]
        : typeNodeMembers(arm, sourceFile),
    );
  }
  return [];
}

/**
 * The doc comment written above one arm of a union, read from the source text rather than from the
 * AST.
 *
 * A union arm is the one documented thing in a `.d.ts` that `getJSDocCommentsAndTags` cannot answer
 * for: the block sits before the `|` that introduces the arm, so it falls outside the arm node and
 * is attached to nothing. Scanning forward from where the previous arm ended is what finds it, and
 * only a `/**` block counts — a `//` note left after an arm is a note, not the next arm's
 * description.
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
    .map((line) => line.replace(/^\s*\*/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The named, typed members of a member list — properties, and nothing a program cannot read. */
function propertyMembers(members, sourceFile) {
  return members
    .filter(
      (member) =>
        (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && member.name,
    )
    .map((member) => ({
      name: member.name.getText(sourceFile),
      type: member.type ? print(member.type, sourceFile) : null,
      doc: docComment(member, sourceFile),
    }));
}

/**
 * The declared type names a piece of declaration text refers to, closed transitively.
 *
 * Transitively, because a declaration that names a type the prompt does not also carry is a dangling
 * reference in front of the model: `searchArchive` returns an `ArchiveSearch`, whose declaration is
 * only useful alongside `ArchiveHit`.
 */
function referencedTypes(text, types, seen = new Set()) {
  for (const [name, { declaration }] of types) {
    if (seen.has(name)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    seen.add(name);
    referencedTypes(declaration, types, seen);
  }
  return seen;
}

/** The `{ signatures, doc, types }` triple for one catalogued export. */
function reflect(js, expectedFile, { functions, types }) {
  const found = functions.get(js);
  if (!found) {
    throw new Error(`\`${js}\` is in the catalogue but no SDK module exports it.`);
  }
  if (path.basename(found.file) !== expectedFile) {
    throw new Error(
      `\`${js}\` is catalogued in ${expectedFile} but is exported by ${path.basename(found.file)}.`,
    );
  }
  const { nodes, sourceFile } = found;
  const signatures = nodes.map((node) => {
    const rendered = node.parameters.map((p) => print(p, sourceFile)).join(", ");
    const returnType = node.type ? print(node.type, sourceFile) : "void";
    return {
      signature: `${js}(${rendered}): ${returnType}`,
      parameters: parametersOf(js, node, sourceFile),
    };
  });
  const doc = docComment(nodes[0], sourceFile);
  if (!doc) {
    throw new Error(
      `\`${js}\` has no doc comment. Every catalogued export's JSDoc is shown to a model in the ` +
        "system prompt, so an undocumented one would reach it as a bare signature.",
    );
  }
  const referenced = new Set();
  for (const { signature } of signatures) {
    for (const name of referencedTypes(signature, types)) referenced.add(name);
  }
  return { signatures, doc, referenced };
}

/**
 * One declaration's parameters, each with the `@param` written for it.
 *
 * `kind` is `positional` for every one of them, and is carried anyway: it is what a language whose
 * arguments are passed BY NAME — Python's keyword arguments, Kotlin's named ones — says instead, and
 * a field only some catalogues fill is a field consumers forget exists.
 */
function parametersOf(js, node, sourceFile) {
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
        doc: required(docs.get(address), js, `the field \`${address}\``, `@param ${address}`),
        fields: [],
      };
    });
    return {
      name,
      type: parameter.type ? print(parameter.type, sourceFile) : "unknown",
      optional: Boolean(parameter.questionToken || parameter.initializer),
      kind: "positional",
      default: parameter.initializer ? print(parameter.initializer, sourceFile) : null,
      doc: required(docs.get(name), js, `the parameter \`${name}\``, `@param ${name}`),
      fields,
    };
  });
  for (const address of docs.keys()) {
    if (!addressed.has(address)) {
      throw new Error(
        `\`${js}\` documents \`${address}\` with an \`@param\`, and its signature declares no such ` +
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
    `\`${subject}\`: ${what} has no documentation. Everything a model reads about this SDK is ` +
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

/** Build the whole catalogue, for the language whose id is `language`. */
async function build(language) {
  const {
    TOOL_CATALOGUE,
    HELPER_CATALOGUE,
    SESSION_ENTRIES,
    SESSION_MODULE,
    VIEW_ENTRIES,
    VIEW_MODULE,
    PROGRAM_ENTRIES,
    PROGRAM_KEYS,
    PROGRAM_MODULE,
    META_ENTRIES,
    META_MODULE,
    OBJECT_FOR_MODULE,
    OBJECT_ORDER,
  } = await loadCatalogue();
  const declarations = index(await loadHeaders());
  // The API object a module's functions are grouped under in a program's scope. The host groups the
  // catalogue by this to build each object's `list()` directory and to route `readDocs`.
  const objectForModule = (module) => {
    const object = OBJECT_FOR_MODULE[module];
    if (!object) throw new Error(`module \`${module}\` has no API object in OBJECT_FOR_MODULE.`);
    return object;
  };
  const moduleForTool = (tool) => TOOL_CATALOGUE.find((entry) => entry.tool === tool)?.module;

  /** @type {Set<string>} */
  const used = new Set(referencedTypes(ALWAYS_INCLUDED_TYPE, declarations.types));

  const order = (name) => declarations.types.get(name)?.order ?? Number.MAX_SAFE_INTEGER;
  const sorted = (names) => [...names].sort((a, b) => order(a) - order(b));

  // The meta functions: reflected exactly as everything else is, minus the `object` field they have
  // no value for. `list` is seeded onto every API object rather than declared on one, so naming an
  // object here would be a claim about the eleven it is not on.
  const meta = META_ENTRIES.map((entry) => {
    const { signatures, doc, referenced } = reflect(entry.js, `${META_MODULE}.d.ts`, declarations);
    for (const name of referenced) used.add(name);
    return {
      key: entry.key,
      name: entry.js,
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  // Reflected exactly as a tool is, minus the `tool` field they have no value for: none is a gg tool,
  // none has a name in `ALL_TOOL_NAMES`, and nothing dispatches them. `key` stands in for that
  // missing identity, and `ending` names the role whose programs each one is bound for, which is what
  // lets the prompt render one group.
  const session = SESSION_ENTRIES.map((entry) => {
    const { signatures, doc, referenced } = reflect(
      entry.js,
      `${SESSION_MODULE}.d.ts`,
      declarations,
    );
    for (const name of referenced) used.add(name);
    return {
      key: entry.key,
      name: entry.js,
      object: entry.object,
      ending: entry.ending,
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  // The view functions, reflected on the same terms as the ending calls: no `tool` field, because
  // none of them has a name in `ALL_TOOL_NAMES` and nothing dispatches them. `requires` carries the
  // one gate among them — `openFile` is a read — and is `null` for the three nothing gates, so the
  // host reads an explicit absence rather than a missing key.
  const views = VIEW_ENTRIES.map((entry) => {
    const { signatures, doc, referenced } = reflect(entry.js, `${VIEW_MODULE}.d.ts`, declarations);
    for (const name of referenced) used.add(name);
    return {
      key: entry.key,
      name: entry.js,
      object: objectForModule(VIEW_MODULE),
      requires: entry.requires ?? null,
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  // The program-library functions, on the same terms again — but with no gate field at all, because
  // the whole object is bound or absent together and what decides that is a capability rather than a
  // tool name. The host reads the array's presence as the family and gates it on its own flag.
  const programs = PROGRAM_ENTRIES.map((js) => {
    const { signatures, doc, referenced } = reflect(
      js,
      `${PROGRAM_MODULE}.d.ts`,
      declarations,
    );
    for (const name of referenced) used.add(name);
    return {
      // The one family whose key is a side table rather than a property on the entry: the shim
      // iterates `PROGRAM_ENTRIES` and is compiled into the committed component, so its shape is
      // deliberately left alone. See `PROGRAM_KEYS`.
      key: PROGRAM_KEYS[js],
      name: js,
      object: objectForModule(PROGRAM_MODULE),
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  const tools = TOOL_CATALOGUE.map((entry) => {
    const { signatures, doc, referenced } = reflect(
      entry.js,
      `${entry.module}.d.ts`,
      declarations,
    );
    for (const name of referenced) used.add(name);
    // No `key`: a tool's gg tool name already IS its language-independent identity, and every
    // language's guest catalogues the same `ALL_TOOL_NAMES`.
    return {
      tool: entry.tool,
      name: entry.js,
      object: objectForModule(entry.module),
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  const helpers = HELPER_CATALOGUE.map((entry) => {
    const { signatures, doc, referenced } = reflect(entry.js, "helpers.d.ts", declarations);
    for (const name of referenced) used.add(name);
    const module = moduleForTool(entry.requires);
    if (!module) throw new Error(`helper \`${entry.js}\` requires unknown tool \`${entry.requires}\`.`);
    return {
      key: entry.key,
      requires: entry.requires,
      name: entry.js,
      object: objectForModule(module),
      signatures,
      doc,
      types: sorted(referenced),
    };
  });

  // A type reaches a model whole: its declaration, the paragraph explaining what it is for, and a
  // line per member. The declaration alone tells a model the shape and nothing about what any field
  // MEANS — `shown: boolean` on a `FileRead` is unguessable — so the members travel with it.
  const types = sorted(used).map((name) => {
    const declared = declarations.types.get(name);
    return {
      name,
      declaration: declared.declaration,
      doc: required(declared.doc, name, "the type", "a doc comment on the declaration"),
      members: declared.members.map((member) => ({
        ...member,
        doc: required(
          member.doc,
          name,
          `the member \`${member.name}\``,
          `a doc comment on ${member.name}`,
        ),
      })),
    };
  });

  // The API objects, in the order the surface is presented in, each with the sentence written on its
  // declaration. Every object a catalogued function hangs off must be here and nothing else may be:
  // an object with no functions would be introduced to a model and then never mentioned again, and a
  // function on an object nobody described would arrive with a bare name over it.
  const grouped = new Set(
    [...session, ...views, ...programs, ...tools, ...helpers].map((entry) => entry.object),
  );
  const objects = OBJECT_ORDER.map((object) => {
    if (!grouped.delete(object)) {
      throw new Error(
        `\`${object}\` is in OBJECT_ORDER and no catalogued function hangs off it; a described ` +
          "object with nothing on it is an object a model is introduced to and never given.",
      );
    }
    const declaration = `OBJECT_${object.toUpperCase()}`;
    const declared = declarations.values.get(declaration);
    if (!declared) {
      throw new Error(
        `\`${object}\` has no \`${declaration}\` constant in src/catalogue.ts to take its ` +
          "description from.",
      );
    }
    if (declared.value !== object) {
      throw new Error(
        `\`${declaration}\` is \`${declared.value}\` and is read as the description of ` +
          `\`${object}\`; the constant the doc comment hangs on must be the object it describes.`,
      );
    }
    return {
      object,
      doc: required(declared.doc, object, "the API object", `a doc comment on ${declaration}`),
    };
  });
  for (const object of grouped) {
    throw new Error(
      `\`${object}\` groups catalogued functions and is not in OBJECT_ORDER, so nothing describes ` +
        "it to a model.",
    );
  }

  return `${JSON.stringify(
    {
      language,
      generatedFrom: GENERATED_FROM,
      objects,
      meta,
      session,
      views,
      programs,
      tools,
      helpers,
      types,
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
    const { objects, meta, views, programs, tools, helpers, types } = JSON.parse(catalogue);
    process.stdout.write(
      `Wrote ${path.relative(process.cwd(), out)} (${objects.length} objects, ` +
        `${tools.length} tools, ${helpers.length} helpers, ${views.length} view functions, ` +
        `${programs.length} program-library functions, ${meta.length} meta functions, ` +
        `${types.length} types).\n`,
    );
  }
}

await main().catch((error) => {
  process.stderr.write(`signatures: ${error.message}\n`);
  process.exit(1);
});
