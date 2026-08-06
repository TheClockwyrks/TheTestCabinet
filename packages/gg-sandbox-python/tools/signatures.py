"""Emit the signature catalogue gg renders the Python arm's system prompt and doc views from.

gg has to tell a model, every turn, what functions its program may call and what they do. The wrong
way to do that is a hand-written list in the prompt template: it drifts away from the SDK silently,
and a model shown a signature the sandbox does not have wastes a whole turn discovering that. So the
list is REFLECTED out of the SDK's own declarations and docstrings instead.

The pipeline:

    packages/gg-sandbox-python/src/gg/**.py
        --griffe (static, no import)-->
    crates/gg/src/sandbox/guests/python.signatures.json

Nothing here imports the SDK. `gg.errors` and every tool module import `wit_world`, which only exists
inside the baked component, so the reflector reads the *sources* with `griffe` — which is also the
right tool for the job: a docstring is documentation, and griffe is Python's own answer to reading
it. `gg.catalogue` is the one module that is loaded rather than parsed, because it is data with no
membrane import in it and re-implementing its tables here would be a second copy of them.

Six properties are enforced here rather than left to review. Every one of them is the same rule under
a different subject: NOTHING a model reads about this SDK may be written anywhere but on the
declaration it describes, and an undocumented declaration is a build error rather than a blank in a
prompt.

  * every catalogued function must exist, in the module the catalogue names for it — a typo in
    `gg/catalogue.py` is an error, not a missing prompt line;
  * every catalogued function must carry a docstring;
  * every PARAMETER a catalogued signature declares must carry an `Args:` entry describing it;
  * an `Args:` entry that names something the signature does not declare is an error too, so a
    renamed parameter cannot leave its description behind under the old name;
  * every TYPE the catalogue carries must be documented, and so must each of its members;
  * every API OBJECT must carry the sentence the prompt introduces it by, taken from the docstring on
    its declaration in `gg/catalogue.py`.

And one more that is this language's own: every public declaration in `gg/types.py` and `gg/errors.py`
must appear in `TYPE_ORDER`. A type nothing lists is a type no signature can safely mention, because
the closure below would silently not find it.

The catalogue carries one thing that is not a signature, on the same rule: the LIBRARY SET a program
may import, read off the module-scope imports of `src/library.py` — the file that decides it, because
`componentize-py` bakes that module's import closure and nothing else. The prompt renders that list,
so what a model is told it may import is what the artifact was built with rather than a sentence
somebody wrote once. See `libraries`.

Usage:
    python tools/signatures.py --out-dir <dir>          # write the catalogue
    python tools/signatures.py --out-dir <dir> --check  # verify the committed copy is current

`--check` is the local rehearsal of the CI drift gate, which regenerates the file and fails on any
`git diff`. `packages/gg-sandbox-python/signatures.sh` is what actually runs this, and is what pins
the `griffe` it runs against.
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable

import griffe

PACKAGE_DIR = Path(__file__).resolve().parent.parent
SRC_DIR = PACKAGE_DIR / "src"

LANGUAGE = "python"
"""The `GgProgramLanguage` id this catalogue carries the spellings of, and the stem its committed
artifacts are filed at. Written into the catalogue so a committed artifact says whose spellings it
carries, and asserted by the host against the language that embedded it."""

GENERATED_FROM = "packages/gg-sandbox-python/src"
"""The provenance string written into the catalogue, so a reader of the JSON knows it is generated
and where from.

The whole of `src`, not just `src/gg`: the SDK's signatures are reflected out of the package, and the
[library set](libraries) is read off `src/library.py` — the module whose imports decide it."""

ALWAYS_INCLUDED_TYPE = "ToolError"
"""The one type declaration the catalogue always carries, whatever a run enables: every call can
raise it."""

TYPE_MODULES = ("types", "errors")
"""The modules a catalogued type may be declared in, in the order they are searched."""


def load_catalogue() -> ModuleType:
    """Load `gg/catalogue.py` as a standalone module.

    It is the one SDK module that can be imported outside the component, because it imports nothing
    but `dataclasses`. Loading it by path rather than as `gg.catalogue` is what keeps `gg/__init__.py`
    — and through it `wit_world` — out of the way.
    """
    path = SRC_DIR / "gg" / "catalogue.py"
    spec = importlib.util.spec_from_file_location("gg_catalogue", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    # Registered before it is executed, because `@dataclass` reads its own class's module out of
    # `sys.modules` while it is deciding what a field's annotation means.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_sources() -> griffe.Module:
    """Parse the whole `gg` package statically, with its docstrings in Google style."""
    return griffe.load(
        "gg",
        search_paths=[str(SRC_DIR)],
        docstring_parser=griffe.Parser.google,
        allow_inspection=False,
        force_inspection=False,
    )


# --- Documentation -------------------------------------------------------------------------------


def flatten(text: str) -> str:
    """One paragraph of prose, as the catalogue carries it.

    Every newline a docstring wraps at becomes a space, exactly as the TypeScript arm's JSDoc does,
    because what this feeds is a markdown prompt rather than a fixed-width file.
    """
    return re.sub(r"\s+", " ", text).strip()


def documentation(function: griffe.Function, where: str) -> str:
    """The model-facing paragraph for one function: its prose, then what it raises.

    The `Raises:` section is folded in rather than dropped, because what a call does when it fails is
    half of what a model needs to write a program that survives one — and a Google-style docstring is
    where a Python author puts it.
    """
    docstring = function.docstring
    if docstring is None or not docstring.value.strip():
        raise SystemExit(
            f"{where} has no docstring. Every catalogued function's documentation is shown to a "
            "model, so an undocumented one would reach it as a bare signature."
        )
    parts: list[str] = []
    for section in docstring.parsed:
        if section.kind is griffe.DocstringSectionKind.text:
            parts.append(flatten(section.value))
        elif section.kind is griffe.DocstringSectionKind.raises:
            for raised in section.value:
                parts.append(f"Raises `{raised.annotation}`: {flatten(raised.description)}")
    return " ".join(part for part in parts if part)


def parameter_docs(function: griffe.Function, where: str) -> dict[str, str]:
    """The `Args:` entries, keyed by the parameter each describes."""
    docs: dict[str, str] = {}
    docstring = function.docstring
    if docstring is None:
        return docs
    for section in docstring.parsed:
        if section.kind is not griffe.DocstringSectionKind.parameters:
            continue
        for described in section.value:
            if described.name in docs:
                raise SystemExit(f"{where} documents `{described.name}` twice.")
            docs[described.name] = flatten(described.description)
    return docs


# --- Signatures ----------------------------------------------------------------------------------


def annotation_of(expression: Any) -> str:
    """One annotation, as the SDK wrote it."""
    return "" if expression is None else str(expression)


def signature_of(function: griffe.Function, name: str, where: str) -> dict[str, Any]:
    """One shape a function may be called in: the signature a model reads, and its parameters.

    Python has one shape per function — an optional argument is a default, never an overload — so
    every entry this reflector emits carries exactly one signature. The `signatures` array is still an
    array, because the count is *spelling*: an overloading language carries two where this carries
    one, and nothing downstream compares them.
    """
    docs = parameter_docs(function, where)
    rendered: list[str] = []
    parameters: list[dict[str, Any]] = []
    starred = False
    for parameter in function.parameters:
        if parameter.kind is griffe.ParameterKind.keyword_only and not starred:
            rendered.append("*")
            starred = True
        annotation = annotation_of(parameter.annotation)
        default = None if parameter.default is None else str(parameter.default)
        piece = f"{parameter.name}: {annotation}" if annotation else parameter.name
        rendered.append(f"{piece} = {default}" if default is not None else piece)
        description = docs.pop(parameter.name, None)
        if description is None:
            raise SystemExit(
                f"{where} declares `{parameter.name}` and its docstring has no `Args:` entry for "
                "it. Every argument a model is asked to fill in is described where it is declared."
            )
        parameters.append(
            {
                "name": parameter.name,
                "type": annotation,
                "optional": parameter.default is not None,
                # Keyword-only arguments are what this language's optional ones are: `kind` is the
                # one axis of calling convention that changes what a model must WRITE.
                "kind": (
                    "keyword"
                    if parameter.kind is griffe.ParameterKind.keyword_only
                    else "positional"
                ),
                "default": default,
                "doc": description,
                # Python has no structured argument written inline at a call site: this SDK spells a
                # membrane record's fields out as the function's own arguments, so there is never a
                # second level to document.
                "fields": [],
            }
        )
    if docs:
        raise SystemExit(
            f"{where}'s docstring documents {sorted(docs)}, which its signature does not declare. A "
            "renamed argument left behind under its old name reads perfectly and tells a model to "
            "write something the call will not accept."
        )
    returns = annotation_of(function.returns) or "None"
    return {
        "signature": f"{name}({', '.join(rendered)}) -> {returns}",
        "parameters": parameters,
    }


@dataclass(frozen=True)
class Reflected:
    """What one catalogued function contributes to the catalogue."""

    signatures: list[dict[str, Any]]
    doc: str
    referenced: set[str]


def reflect(
    sources: griffe.Module, module: str, name: str, types: dict[str, str]
) -> Reflected:
    """Everything the catalogue carries about one function, read off its declaration."""
    where = f"`{module}.{name}`"
    try:
        found = sources[f"{module}.{name}"]
    except KeyError:
        raise SystemExit(
            f"{where} is in the catalogue and `gg/{module.replace('.', '/')}.py` does not define it."
        ) from None
    if not isinstance(found, griffe.Function):
        raise SystemExit(f"{where} is catalogued as a function and is a {found.kind.value}.")
    signature = signature_of(found, name, where)
    referenced: set[str] = set()
    for candidate in referenced_types(signature["signature"], types):
        referenced.add(candidate)
    return Reflected([signature], documentation(found, where), referenced)


def referenced_types(text: str, types: dict[str, str], seen: set[str] | None = None) -> set[str]:
    """The declared type names a piece of text refers to, closed transitively.

    Transitively, because a declaration that names a type the prompt does not also carry is a dangling
    reference in front of the model: `context.search_archive` returns an `ArchiveSearch`, whose
    declaration is only useful alongside `ArchiveHit`.
    """
    seen = set() if seen is None else seen
    for name, declaration in types.items():
        if name in seen or not re.search(rf"\b{re.escape(name)}\b", text):
            continue
        seen.add(name)
        referenced_types(declaration, types, seen)
    return seen


# --- Types ---------------------------------------------------------------------------------------


def base_names(cls: griffe.Class) -> list[str]:
    """The class's bases, by name."""
    return [str(base) for base in cls.bases]


def member_doc(owner: str, name: str, member: Any) -> str:
    """One member's documentation, or a build error naming what is missing."""
    docstring = getattr(member, "docstring", None)
    if docstring is None or not docstring.value.strip():
        raise SystemExit(
            f"`{owner}.{name}` has no docstring. A record whose fields arrive unexplained is a record "
            "a model has to guess at."
        )
    return flatten(docstring.value)


def declare_type(name: str, declared: Any) -> dict[str, Any]:
    """One type, as the catalogue carries it: its declaration, its paragraph, and a line per member.

    Three shapes reach a model through this: a **dataclass**, whose members are its fields; an
    **enum**, whose members are values rather than fields and so carry no type of their own — the same
    convention the TypeScript arm's union-of-literals uses; and a **union alias**, which is a name for
    two classes catalogued in their own right and so has no members here.
    """
    docstring = getattr(declared, "docstring", None)
    if docstring is None or not docstring.value.strip():
        raise SystemExit(f"the type `{name}` has no docstring.")
    doc = flatten(docstring.value)

    if isinstance(declared, griffe.Attribute):
        return {
            "name": name,
            "declaration": f"{name} = {annotation_of(declared.value)}",
            "doc": doc,
            "members": [],
        }

    bases = base_names(declared)
    members: list[dict[str, Any]] = []
    lines: list[str] = []
    if "Enum" in bases:
        header = f"class {name}(Enum):"
        for member_name, member in declared.members.items():
            if not isinstance(member, griffe.Attribute):
                continue
            lines.append(f"    {member_name}")
            members.append(
                {
                    "name": member_name,
                    # A member is the value, not a field holding one, so it carries no type beside
                    # itself. Its wire spelling is deliberately not shown: the member's NAME is the
                    # API, and a model shown `PENDING = "pending"` would reach for the string.
                    "type": None,
                    "doc": member_doc(name, member_name, member),
                }
            )
    else:
        decorators = [str(decorator.value) for decorator in declared.decorators]
        inherits = f"({', '.join(bases)})" if bases else ""
        header = f"class {name}{inherits}:"
        lines_before = [f"@{decorator}" for decorator in decorators]
        header = "\n".join([*lines_before, header])
        for member_name, member in declared.members.items():
            if not isinstance(member, griffe.Attribute) or member_name.startswith("_"):
                continue
            annotation = annotation_of(member.annotation)
            lines.append(f"    {member_name}: {annotation}")
            members.append(
                {
                    "name": member_name,
                    "type": annotation,
                    "doc": member_doc(name, member_name, member),
                }
            )
    if not members:
        raise SystemExit(f"the type `{name}` declares no members a model could read.")
    return {
        "name": name,
        "declaration": "\n".join([header, *lines]),
        "doc": doc,
        "members": members,
    }


def type_declarations(sources: griffe.Module, order: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Every catalogued type, in `TYPE_ORDER`, each read off the declaration it is written on.

    Also the check that nothing was left out: a public declaration in `gg/types.py` or `gg/errors.py`
    that `TYPE_ORDER` does not name is a type the closure above could never find, so it would
    silently never reach a model.
    """
    listed = list(order)
    declared: dict[str, dict[str, Any]] = {}
    for name in listed:
        for module in TYPE_MODULES:
            found = sources[module].members.get(name)
            if found is not None:
                declared[name] = declare_type(name, found)
                break
        else:
            raise SystemExit(
                f"`{name}` is in TYPE_ORDER and neither {' nor '.join(TYPE_MODULES)} declares it."
            )
    for module in TYPE_MODULES:
        exported = sources[module].members.get("__all__")
        if exported is None:
            continue
        for name in literal_strings(exported):
            if name not in listed and name.isupper():
                # A module-level CONSTANT rather than a type — `UNCHANGED` is the value, `Unchanged`
                # the type — and the value travels with its type rather than as a declaration of its
                # own.
                continue
            if name not in listed:
                raise SystemExit(
                    f"`gg.{module}` exports `{name}` and TYPE_ORDER does not list it, so no "
                    "signature that mentions it could ever have its declaration shown."
                )
    return declared


def literal_strings(attribute: griffe.Attribute) -> list[str]:
    """The string literals in an `__all__`, read off its source rather than evaluated."""
    return re.findall(r"[\"']([^\"']+)[\"']", str(attribute.value))


# --- The libraries -------------------------------------------------------------------------------

LIBRARY_SOURCE = SRC_DIR / "library.py"
"""The module whose module-scope imports *are* the library set.

`componentize-py` bakes the entry module's executed import closure, so what this file imports is
what a program can import — a bake-time fact about the artifact rather than a policy. See its own
docstring for why, and `crates/gg/src/sandbox/language/python.substrate.test.rs` for the test that
asks the committed component whether every name below really landed.
"""

GROUP_HEADER = re.compile(r"^#\s*-{3,}\s*(?P<title>.+?)\s*-{3,}\s*$")
"""The comment a group of imports is filed under: `# --- Time ------`.

Model-facing text that is written **on the code that decides the set**, which is the same rule every
signature and every argument description in this file obeys. A prompt that grouped these libraries in
a table of its own would be a second copy of `library.py` to keep in step.
"""


def libraries() -> list[dict[str, Any]]:
    """The importable library set, grouped as `library.py` groups it.

    Read off the source text rather than out of `griffe`, because what is wanted is the *statements*
    — including the comment headers, which no API reflector reports — and because the answer must be
    the dotted name a program writes: `urllib.parse` is importable and `urllib.robotparser` is not,
    so a list flattened to top-level packages would overclaim exactly the way the prose it replaces
    did.

    Four properties are enforced, on the rule the rest of this reflector obeys — nothing a model
    reads may be written anywhere but on the code it describes, and a gap is a build error rather
    than a blank in a prompt:

      * every module-scope import falls under a group header, so none is silently ungrouped;
      * the statements this scan found are exactly the module-scope imports `ast` reports, so a
        shape the scan does not understand is an error rather than a quiet omission;
      * `library.py` uses `import x` only — a `from x import y` imports a *name*, which is not
        something a program can be told it may import;
      * no name is listed twice, in one group or across two.
    """
    source = LIBRARY_SOURCE.read_text(encoding="utf-8")
    grouped: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    title: str | None = None
    for number, line in enumerate(source.splitlines(), start=1):
        header = GROUP_HEADER.match(line)
        if header is not None:
            title = header["title"]
            grouped.append({"group": title, "modules": []})
            continue
        if not line.startswith("import "):
            continue
        name = line.removeprefix("import ").strip()
        if title is None:
            raise SystemExit(
                f"{LIBRARY_SOURCE}:{number} imports `{name}` before any `# --- <group> ---` header, "
                "so a model would be told about a library under no heading."
            )
        if name in seen:
            raise SystemExit(
                f"{LIBRARY_SOURCE}:{number} imports `{name}` a second time (already under "
                f"`{seen[name]}`)."
            )
        seen[name] = title
        grouped[-1]["modules"].append(name)

    declared = set()
    for node in ast.parse(source).body:
        if isinstance(node, ast.ImportFrom):
            raise SystemExit(
                f"{LIBRARY_SOURCE}:{node.lineno} uses `from … import …`. This file's imports are the "
                "list of modules a program may import, and a name imported out of one is not a "
                "module."
            )
        if isinstance(node, ast.Import):
            declared.update(alias.name for alias in node.names)
    if declared != set(seen):
        missed = sorted(declared - set(seen)) or sorted(set(seen) - declared)
        raise SystemExit(
            f"{LIBRARY_SOURCE}'s module-scope imports and the grouped scan disagree about {missed}. "
            "The scan reads `import x` at the start of a line; write the import that way, or teach "
            "this function the shape."
        )

    for group in grouped:
        if not group["modules"]:
            raise SystemExit(
                f"the `{group['group']}` group in {LIBRARY_SOURCE} has no imports under it."
            )
        group["modules"].sort()
    return grouped


# --- The catalogue -------------------------------------------------------------------------------


def build() -> str:
    """The whole catalogue, as the JSON text the guests directory carries."""
    catalogue = load_catalogue()
    sources = load_sources()

    declarations = type_declarations(sources, catalogue.TYPE_ORDER)
    types_by_declaration = {
        name: declared["declaration"] for name, declared in declarations.items()
    }
    used: set[str] = referenced_types(ALWAYS_INCLUDED_TYPE, types_by_declaration)

    def order(names: Iterable[str]) -> list[str]:
        listed = list(catalogue.TYPE_ORDER)
        return sorted(names, key=listed.index)

    def entry(module: str, name: str) -> Reflected:
        reflected = reflect(sources, module, name, types_by_declaration)
        used.update(reflected.referenced)
        return reflected

    tools_module = "tools"
    object_for_tool = {
        item.tool: catalogue.OBJECT_FOR_MODULE[item.module] for item in catalogue.TOOL_CATALOGUE
    }

    meta = []
    for item in catalogue.META_ENTRIES:
        reflected = entry(f"{tools_module}.{catalogue.META_MODULE}", item.python)
        meta.append(
            {
                "key": item.key,
                "name": item.python,
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    session = []
    for item in catalogue.SESSION_ENTRIES:
        reflected = entry(catalogue.SESSION_MODULE, item.python)
        session.append(
            {
                "key": item.key,
                "name": item.python,
                "object": item.object,
                "ending": item.ending,
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    views = []
    for item in catalogue.VIEW_ENTRIES:
        reflected = entry(f"{tools_module}.{catalogue.VIEW_MODULE}", item.python)
        views.append(
            {
                "key": item.key,
                "requires": item.requires,
                "name": item.python,
                "object": catalogue.OBJECT_FOR_MODULE[catalogue.VIEW_MODULE],
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    programs = []
    for item in catalogue.PROGRAM_ENTRIES:
        reflected = entry(f"{tools_module}.{catalogue.PROGRAM_MODULE}", item.python)
        programs.append(
            {
                "key": item.key,
                "name": item.python,
                "object": catalogue.OBJECT_FOR_MODULE[catalogue.PROGRAM_MODULE],
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    tools = []
    for item in catalogue.TOOL_CATALOGUE:
        reflected = entry(f"{tools_module}.{item.module}", item.python)
        tools.append(
            {
                "tool": item.tool,
                "name": item.python,
                "object": catalogue.OBJECT_FOR_MODULE[item.module],
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    helpers = []
    for item in catalogue.HELPER_CATALOGUE:
        reflected = entry(catalogue.HELPER_MODULE, item.python)
        helpers.append(
            {
                "key": item.key,
                "requires": item.requires,
                "name": item.python,
                # A helper hangs off the object of the tool it is built on, which is the whole of
                # what "bound alongside" means.
                "object": object_for_tool[item.requires],
                "signatures": reflected.signatures,
                "doc": reflected.doc,
                "types": order(reflected.referenced),
            }
        )

    objects = api_objects(catalogue, sources, tools, helpers, views, programs, session)

    unused = [name for name in catalogue.TYPE_ORDER if name not in used]
    if unused:
        raise SystemExit(
            f"{unused} are declared and no signature mentions them, so nothing would ever show them "
            "to a model. Remove them, or reference them from the signature that returns one."
        )

    return (
        json.dumps(
            {
                "language": LANGUAGE,
                "generatedFrom": GENERATED_FROM,
                "libraries": libraries(),
                "objects": objects,
                "meta": meta,
                "session": session,
                "views": views,
                "programs": programs,
                "tools": tools,
                "helpers": helpers,
                "types": [declarations[name] for name in order(used)],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


def api_objects(
    catalogue: ModuleType,
    sources: griffe.Module,
    *sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """The API objects, in presentation order, each with the sentence a model is introduced to it by.

    The sentence comes off the docstring on the constant in `gg/catalogue.py` that *is* the object's
    name — written where the object is declared, for the reason every function's description is
    written on the function.
    """
    constants = {
        getattr(catalogue, name): name
        for name in dir(catalogue)
        if name.startswith("OBJECT_") and isinstance(getattr(catalogue, name), str)
    }
    grouped = {item["object"] for section in sections for item in section}
    described: list[dict[str, Any]] = []
    for object_name in catalogue.OBJECT_ORDER:
        constant = constants.get(object_name)
        if constant is None:
            raise SystemExit(
                f"`{object_name}` is in OBJECT_ORDER and no `OBJECT_*` constant holds it, so there "
                "is no declaration its description could be written on."
            )
        declared = sources["catalogue"].members.get(constant)
        docstring = getattr(declared, "docstring", None)
        if docstring is None or not docstring.value.strip():
            raise SystemExit(f"`{constant}` has no docstring describing the `{object_name}` object.")
        if object_name not in grouped:
            raise SystemExit(
                f"the API object `{object_name}` is described and no catalogued function hangs off "
                "it, so a model would be introduced to an object it is never given."
            )
        described.append({"object": object_name, "doc": flatten(docstring.value)})
        grouped.discard(object_name)
    for object_name in sorted(grouped):
        raise SystemExit(
            f"`{object_name}` groups catalogued functions and is not in OBJECT_ORDER, so nothing "
            "describes it to a model."
        )
    return described


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()

    out = arguments.out_dir / f"{LANGUAGE}.signatures.json"
    catalogue = build()
    if arguments.check:
        committed = out.read_text(encoding="utf-8") if out.exists() else ""
        if committed != catalogue:
            raise SystemExit(
                f"{out} is stale. Regenerate it with `packages/gg-sandbox-python/signatures.sh` and "
                "commit the result."
            )
        print(f"{out} is up to date.")
        return
    arguments.out_dir.mkdir(parents=True, exist_ok=True)
    out.write_text(catalogue, encoding="utf-8")
    parsed = json.loads(catalogue)
    print(
        f"Wrote {out} ({len(parsed['objects'])} objects, {len(parsed['tools'])} tools, "
        f"{len(parsed['helpers'])} helpers, {len(parsed['views'])} view functions, "
        f"{len(parsed['programs'])} program-library functions, {len(parsed['meta'])} meta "
        f"functions, {len(parsed['types'])} types, "
        f"{sum(len(group['modules']) for group in parsed['libraries'])} libraries)."
    )


if __name__ == "__main__":
    sys.exit(main())
