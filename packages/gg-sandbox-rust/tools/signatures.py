#!/usr/bin/env python3
"""Reflect the **Rust** program language's signature catalogue out of the SDK's own rustdoc, and
write it to ``crates/gg/src/sandbox/guests/rust.signatures.json``.

WHY RUSTDOC JSON. Everything a model reads about this surface is written on the declaration it
describes — a function's description in its ``///`` comment, an argument's in that comment's
``# Arguments`` list, a struct field's on the field, an enum variant's on the variant, an API
object's in the first line of its module's ``//!`` — and ``rustdoc``'s own JSON output is what reads
all of it, together with the *types*, which it has already resolved. Nothing here is prose typed into
a table.

WHY ``# Arguments`` RATHER THAN A PER-PARAMETER SLOT. Rust has no per-parameter doc comment: ``///``
written on a parameter is a compile error, not a doc. So the language's own convention stands in for
one, and this reflector holds it to being a real contract rather than a habit: a signature that takes
*N* arguments must document *N*, in order, under their own names, or the reflection fails. The
failure lands on the author rather than on a model.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
from ``catalogue.py`` (a tool name, an object, a gate) or text lifted out of a doc comment. A blank
anywhere is an error.

Usage (through ``signatures.sh``, which builds the doc JSON first):

    signatures.py <rustdoc.json> <Cargo.toml> <out.json>
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogue  # noqa: E402  (the identity table, beside this file)

#: What the emitted catalogue records itself as reflected from.
GENERATED_FROM = "packages/gg-sandbox-rust/src/ (rustdoc --output-format json)"

#: The types every call's failure arm refers to, added to every entry's `types` because every
#: function in this SDK returns `Result<_, ToolError>` — including the two that cannot fail, whose
#: signature says so.
ALWAYS_REFERENCED = ("ToolError", "ToolErrorCode")


class Failure(Exception):
    """Something a model would have read is missing, or says something the code does not."""


# ------------------------------------------------------------------------------------------------
# The doc JSON
# ------------------------------------------------------------------------------------------------


class Docs:
    """One ``rustdoc --output-format json`` document, indexed the way this reflector walks it."""

    def __init__(self, document):
        self.index = document["index"]
        self.root = self.item(document["root"])

    def item(self, identifier):
        return self.index[str(identifier)]

    def module_items(self, module):
        return [self.item(child) for child in module["inner"]["module"]["items"]]

    def modules_of(self, module):
        """The public modules declared in `module`, in declaration order."""
        return [
            child for child in self.module_items(module) if "module" in child["inner"]
        ]

    def functions_of(self, module):
        """The public functions declared in `module`, in declaration order."""
        return [
            child for child in self.module_items(module) if "function" in child["inner"]
        ]


# ------------------------------------------------------------------------------------------------
# Documentation text
# ------------------------------------------------------------------------------------------------

#: A rustdoc intra-doc link, in the three shapes this SDK writes: ``[`X`](path)``, ``[`X`]`` and
#: ``[text](url)``. A model reads prose rather than rustdoc, and a link whose target is a Rust path
#: renders as a broken one, so the link is unwrapped and the text kept.
_LINKED_CODE = re.compile(r"\[`([^`]+)`\]\([^)]*\)")
_BARE_CODE_LINK = re.compile(r"\[`([^`]+)`\]")
_LINKED_TEXT = re.compile(r"\[([^\]]+)\]\([^)]*\)")

#: One entry of a ``# Arguments`` list: ``* `name` — what to put here``.
_ARGUMENT = re.compile(r"^\* `([A-Za-z0-9_]+)` — (.*)$")

#: A fenced code block opened with rustdoc's `ignore` attribute, which is metadata for the doctest
#: runner rather than anything a model should read.
_IGNORED_FENCE = re.compile(r"^```ignore$", re.MULTILINE)


def prose(text):
    """A doc comment as a model reads it: links unwrapped, fences plain, whitespace settled."""
    # `” ```ignore ”` is how a doc comment in this SDK says "do not compile this as a doctest": the
    # examples are program fragments, written against a scope only a real turn has. A model reads a
    # fenced block, not a rustdoc attribute, so the attribute comes off.
    text = _IGNORED_FENCE.sub("```", text)
    text = _LINKED_CODE.sub(r"`\1`", text)
    text = _BARE_CODE_LINK.sub(r"`\1`", text)
    text = _LINKED_TEXT.sub(r"\1", text)
    return unwrapped(text).strip()


def unwrapped(text):
    """A doc comment's paragraphs joined back into single lines.

    A `///` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading Rust rather than anything a model should be shown: they turn one sentence into three
    lines in a system prompt and make a diff of the catalogue a diff of where the author's editor
    wrapped. Blank lines, list items and fenced blocks all survive — the first two because they are
    structure, the third because whitespace inside it is the code.
    """
    out = []
    paragraph = []
    fenced = False

    def flush():
        if paragraph:
            out.append(" ".join(paragraph))
            paragraph.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            flush()
            fenced = not fenced
            out.append(line)
            continue
        if fenced:
            out.append(line)
            continue
        if not stripped:
            flush()
            out.append("")
        elif stripped.startswith(("* ", "- ", "| ", "#")) or stripped.startswith("1. "):
            flush()
            paragraph.append(stripped)
        else:
            paragraph.append(stripped)
    flush()
    return "\n".join(out)


def sections(docs):
    """A doc comment split into its body and its ``#`` sections, in order.

    Returns ``(body, {heading: text})``. A heading a doc does not carry is simply absent; the body is
    everything before the first one.
    """
    body = []
    found = {}
    heading = None
    current = []
    for line in docs.splitlines():
        if line.startswith("# ") and not line.startswith("# ` "):
            if heading is None:
                body = current
            else:
                found[heading] = current
            heading = line[2:].strip()
            current = []
        else:
            current.append(line)
    if heading is None:
        body = current
    else:
        found[heading] = current
    return "\n".join(body), {name: "\n".join(lines) for name, lines in found.items()}


def described(item, what):
    """An item's documentation, minus the ``# Arguments`` list, refusing a blank one.

    ``# Errors`` stays: it is what a model needs in order to know which failures to expect, and it
    reads as part of the description rather than as metadata about the arguments.
    """
    docs = item.get("docs") or ""
    body, found = sections(docs)
    parts = [prose(body)]
    for heading, text in found.items():
        if heading == "Arguments":
            continue
        parts.append("# " + heading + "\n\n" + prose(text))
    text = "\n\n".join(part for part in parts if part)
    if not text:
        raise Failure(f"{what} has no documentation")
    return text


def documented_arguments(item, what):
    """The ``# Arguments`` list of a doc comment, as ``[(name, description)]``."""
    _, found = sections(item.get("docs") or "")
    if "Arguments" not in found:
        return []
    arguments = []
    for line in found["Arguments"].splitlines():
        matched = _ARGUMENT.match(line.strip()) if line.startswith("* ") else None
        if matched:
            arguments.append([matched.group(1), matched.group(2).strip()])
        elif line.strip() and arguments:
            # A continuation line of the entry above it, which is how a long description is wrapped.
            arguments[-1][1] += " " + line.strip()
        elif line.strip():
            raise Failure(f"{what}: `# Arguments` carries a line that is not an argument: {line!r}")
    return [(name, prose(description)) for name, description in arguments]


# ------------------------------------------------------------------------------------------------
# Types, rendered as Rust writes them
# ------------------------------------------------------------------------------------------------


def short(path):
    """A path's last segment, which is the name a program writes.

    `rustdoc` reports a type by the path the declaration was WRITTEN with — `crate::types::FileRead`
    where the module imported it that way, and `$crate::types::FunctionSummary` where the
    declaration came out of a macro. Neither is what a model writes: gg puts `use gg::prelude::*;` in
    front of every program, so every type in this surface is reachable by its bare name, and the bare
    name is what the signature must show.
    """
    return path.rsplit("::", 1)[-1]


def render_type(node):
    """One rustdoc type node, written the way the SDK's own source writes it."""
    if node is None:
        return "()"
    if "primitive" in node:
        return node["primitive"]
    if "borrowed_ref" in node:
        reference = node["borrowed_ref"]
        lifetime = f"{reference['lifetime']} " if reference.get("lifetime") else ""
        mutable = "mut " if reference.get("is_mutable") else ""
        return f"&{lifetime}{mutable}{render_type(reference['type'])}"
    if "slice" in node:
        return f"[{render_type(node['slice'])}]"
    if "array" in node:
        return f"[{render_type(node['array']['type'])}; {node['array']['len']}]"
    if "tuple" in node:
        return "(" + ", ".join(render_type(part) for part in node["tuple"]) + ")"
    if "generic" in node:
        return node["generic"]
    if "resolved_path" in node:
        path = node["resolved_path"]
        return short(path["path"]) + render_arguments(path.get("args"))
    raise Failure(f"a type this reflector cannot render: {json.dumps(node)[:200]}")


def render_arguments(args):
    """The generic arguments of a path, including the elided lifetime a borrowed type carries."""
    if not args or "angle_bracketed" not in args:
        return ""
    bracketed = args["angle_bracketed"]
    rendered = []
    for argument in bracketed.get("args", []):
        if "type" in argument:
            rendered.append(render_type(argument["type"]))
        elif "lifetime" in argument:
            rendered.append(argument["lifetime"])
    return "<" + ", ".join(rendered) + ">" if rendered else ""


def referenced(node, out):
    """Every path name a type node mentions, collected in the order it mentions them."""
    if node is None:
        return
    if "borrowed_ref" in node:
        referenced(node["borrowed_ref"]["type"], out)
    elif "slice" in node:
        referenced(node["slice"], out)
    elif "array" in node:
        referenced(node["array"]["type"], out)
    elif "tuple" in node:
        for part in node["tuple"]:
            referenced(part, out)
    elif "resolved_path" in node:
        path = node["resolved_path"]
        out.append(short(path["path"]))
        args = path.get("args")
        if args and "angle_bracketed" in args:
            for argument in args["angle_bracketed"].get("args", []):
                if "type" in argument:
                    referenced(argument["type"], out)


# ------------------------------------------------------------------------------------------------
# Declarations
# ------------------------------------------------------------------------------------------------


def generic_header(item):
    """The lifetime and type parameters a declaration is written with — ``<'a>``, or nothing."""
    inner = item["inner"].get("struct") or item["inner"].get("enum") or {}
    params = inner.get("generics", {}).get("params", [])
    named = [param["name"] for param in params]
    return "<" + ", ".join(named) + ">" if named else ""


def declaration_of(docs, item, name):
    """One type's declaration and its members, as a model reads them.

    A struct is its public fields; an enum is its variants, each carrying the type it wraps when it
    wraps one. Both are rendered on one line, because a declaration in this catalogue is a *shape* a
    model reads at a glance and the members carry the meaning.
    """
    header = generic_header(item)
    if "struct" in item["inner"]:
        fields = []
        members = []
        kind = item["inner"]["struct"]["kind"]
        if "plain" not in kind:
            raise Failure(f"`{name}` is not a plain struct, which this catalogue cannot render")
        for identifier in kind["plain"]["fields"]:
            field = docs.item(identifier)
            rendered = render_type(field["inner"]["struct_field"])
            fields.append(f"{field['name']}: {rendered}")
            members.append(
                {
                    "name": field["name"],
                    "type": rendered,
                    "doc": described(field, f"`{name}::{field['name']}`"),
                }
            )
        return f"struct {name}{header} {{ " + ", ".join(fields) + " }", members

    if "enum" in item["inner"]:
        arms = []
        members = []
        for identifier in item["inner"]["enum"]["variants"]:
            variant = docs.item(identifier)
            kind = variant["inner"]["variant"]["kind"]
            carried = None
            if isinstance(kind, dict) and "tuple" in kind:
                carried = ", ".join(
                    render_type(docs.item(field)["inner"]["struct_field"])
                    for field in kind["tuple"]
                    if field is not None
                )
            arms.append(f"{variant['name']}({carried})" if carried else variant["name"])
            members.append(
                {
                    "name": variant["name"],
                    "type": carried,
                    "doc": described(variant, f"`{name}::{variant['name']}`"),
                }
            )
        return f"enum {name}{header} {{ " + ", ".join(arms) + " }", members

    raise Failure(f"`{name}` is neither a struct nor an enum")


# ------------------------------------------------------------------------------------------------
# The reflection
# ------------------------------------------------------------------------------------------------


class Reflector:
    def __init__(self, docs):
        self.docs = docs
        self.objects = {}
        self.declarable = {}
        self.types = {}
        self.collect()

    def collect(self):
        """Index the crate: the API-object modules, and every type a signature could name.

        A type is "namable" exactly when the crate root RE-EXPORTS it, which is the same set
        `gg::prelude` offers and therefore the same set a program has in scope with no import of its
        own. Reading the re-exports rather than scanning every declaration in the index is also what
        keeps the generated `bindings` module out: it declares a `ToolError` and a `FileRead` of its
        own — the wire's, with the WIT's documentation — and a catalogue that picked those up would
        describe the membrane to a model instead of the SDK.
        """
        for module in self.docs.modules_of(self.docs.root):
            name = module["name"]
            if name in catalogue.OBJECTS:
                self.objects[name] = module
        for item in self.docs.module_items(self.docs.root):
            reexport = item["inner"].get("use")
            if not reexport or reexport.get("is_glob") or reexport.get("id") is None:
                continue
            target = self.docs.item(reexport["id"])
            if "struct" in target["inner"] or "enum" in target["inner"]:
                self.declarable[reexport["name"]] = target

        missing = [name for name in catalogue.OBJECTS if name not in self.objects]
        if missing:
            raise Failure(f"the catalogue names API objects this crate has no module for: {missing}")

    # -- functions -------------------------------------------------------------------------------

    def function(self, object_, name):
        """One public function of an API object's module."""
        for item in self.docs.functions_of(self.objects[object_]):
            if item["name"] == name:
                return item
        raise Failure(f"the catalogue names `{object_}::{name}`, which this crate does not declare")

    def signature(self, item, name, what):
        """One function's single calling shape, and the arguments it documents.

        Rust has no overloads, so an entry always carries exactly one shape — where Java's carries
        one per overload and Ruby's one per block form. The count is spelling; nothing downstream
        compares it.
        """
        sig = item["inner"]["function"]["sig"]
        arguments = documented_arguments(item, what)
        rendered = [(argument, render_type(node)) for argument, node in sig["inputs"]]
        if len(arguments) != len(rendered):
            raise Failure(
                f"{what} takes {len(rendered)} arguments and documents {len(arguments)} — Rust has "
                "no per-parameter doc slot, so every one of them must appear in the `# Arguments` "
                "list of the function's own comment, in order"
            )
        parameters = []
        for (documented, description), (argument, kind) in zip(arguments, rendered):
            if documented != argument:
                raise Failure(
                    f"{what} documents `{documented}` where its signature takes `{argument}` — a "
                    "renamed argument left behind in the documentation tells a model to write "
                    "something the call will not accept"
                )
            if not description:
                raise Failure(f"{what}'s `{argument}` has no description")
            parameters.append(
                {
                    "name": argument,
                    "type": kind,
                    # Nothing in a Rust call may be left out: there are no default arguments and no
                    # keyword arguments, so `read_file(path)` is not a call this SDK offers. An
                    # argument a program may say nothing *about* says so in its TYPE — `Option<f64>`,
                    # or an options struct with a `Default` — which is where a Rust author looks.
                    "optional": False,
                    "kind": "positional",
                    "default": None,
                    "doc": description,
                    # Always empty: every structured argument here is typed by NAME, and that type is
                    # catalogued with its own documented members. Filling both would be two copies of
                    # one sentence with nothing keeping them equal.
                    "fields": [],
                }
            )
        arguments_text = ", ".join(
            f"{argument}: {kind}" for argument, kind in rendered
        )
        output = sig.get("output")
        returns = f" -> {render_type(output)}" if output is not None else ""
        return {
            "signature": f"{name}({arguments_text}){returns}",
            "parameters": parameters,
        }, sig

    def entry(self, spec):
        """One catalogue entry, whatever section it belongs to."""
        what = f"`{spec['object']}::{spec['name']}`"
        item = self.function(spec["object"], spec["name"])
        shape, sig = self.signature(item, spec["name"], what)
        names = []
        for _, node in sig["inputs"]:
            referenced(node, names)
        referenced(sig.get("output"), names)
        return {
            "name": spec["name"],
            "object": spec["object"],
            "signatures": [shape],
            "doc": described(item, what),
            "types": self.close_over(names),
        }

    def close_over(self, names):
        """The crate's own types a signature mentions, transitively closed, in first-mention order.

        A type this crate does not declare — `Option`, `Vec`, `Result`, `RangeInclusive` — is not
        catalogued and is not meant to be: it is Rust's, a model already knows it, and a declaration
        of it would be gg describing the standard library.
        """
        pending = list(names) + list(ALWAYS_REFERENCED)
        seen = []
        while pending:
            name = pending.pop(0)
            if name in seen or name not in self.declarable:
                continue
            seen.append(name)
            self.declare(name)
            for member in self.types[name]["members"]:
                if member["type"]:
                    more = []
                    referenced_names(member["type"], more)
                    pending.extend(more)
        return seen

    def declare(self, name):
        """Record one type's declaration, once."""
        if name in self.types:
            return
        item = self.declarable[name]
        rendered, members = declaration_of(self.docs, item, name)
        self.types[name] = {
            "name": name,
            "declaration": rendered,
            "doc": described(item, f"the type `{name}`"),
            "members": members,
        }

    # -- the whole document ----------------------------------------------------------------------

    def objects_section(self):
        """Each API object's one-line description: the first line of its module's own `//!`."""
        out = []
        for name in catalogue.OBJECTS:
            docs = (self.objects[name].get("docs") or "").strip()
            first = " ".join(
                line.strip() for line in docs.split("\n\n")[0].splitlines()
            ).strip()
            if not first:
                raise Failure(f"the `{name}` module has no documentation to introduce it by")
            out.append({"object": name, "doc": prose(first)})
        return out

    def meta_section(self):
        """The `list` every object carries, read once and asserted identical on all twelve.

        It is declared by one macro and expanded into each module, so twelve identical declarations
        are the *expected* state and any difference between them would mean the macro had been
        bypassed on one object — a function a model is told about on twelve objects and given on
        eleven.
        """
        entries = []
        for name in catalogue.OBJECTS:
            item = self.function(name, "list")
            shape, sig = self.signature(item, "list", f"`{name}::list`")
            names = []
            referenced(sig.get("output"), names)
            entries.append(
                {
                    "key": "list",
                    "name": "list",
                    "signatures": [shape],
                    "doc": described(item, f"`{name}::list`"),
                    "types": [
                        found for found in self.close_over(names) if found not in ALWAYS_REFERENCED
                    ],
                }
            )
        first = entries[0]
        for other in entries[1:]:
            if other != first:
                raise Failure(
                    "the `list` an API object carries is not the same declaration on every object; "
                    "it is expanded from one macro and must be"
                )
        return [first]

    def sanity_check(self):
        """Every public function of an API object is named by the identity table, and vice versa.

        The direction that matters is this one: a function added to an SDK module and forgotten here
        is a capability a model is never told it has, which no other gate would notice.
        """
        named = {(spec["object"], spec["name"]) for spec in catalogue.ENTRIES}
        for object_ in catalogue.OBJECTS:
            for item in self.docs.functions_of(self.objects[object_]):
                if item["name"] == "list":
                    continue
                if (object_, item["name"]) not in named:
                    raise Failure(
                        f"`{object_}::{item['name']}` is public and nothing in `catalogue.py` names "
                        "it, so a model would never be told it exists"
                    )

    def build(self, libraries):
        self.sanity_check()
        document = {
            "language": "rust",
            "generatedFrom": GENERATED_FROM,
            "libraries": libraries,
            "objects": self.objects_section(),
            "meta": self.meta_section(),
            "session": [],
            "views": [],
            "programs": [],
            "tools": [],
            "helpers": [],
            "types": [],
        }
        for spec in catalogue.ENTRIES:
            entry = self.entry(spec)
            if spec["section"] == "tools":
                entry = {"tool": spec["key"], **entry}
            else:
                entry = {"key": spec["key"], **entry}
            if spec["section"] == "session":
                entry["ending"] = spec["ending"]
            if spec["section"] == "views":
                entry["requires"] = spec["gate"]
            if spec["section"] == "helpers":
                entry["requires"] = spec["gate"]
            document[spec["section"]].append(entry)
        document["types"] = [self.types[name] for name in sorted(self.types)]
        return document


def referenced_names(rendered, out):
    """Every identifier a rendered type mentions, for closing over a member's own type.

    A rendered type is a string by the time a member carries it, so this reads the identifiers back
    out of it rather than re-walking the node — which is enough, because what it feeds is a lookup
    against the crate's own declarations and anything else is discarded.
    """
    out.extend(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", rendered))


# ------------------------------------------------------------------------------------------------
# The library set
# ------------------------------------------------------------------------------------------------


def libraries_of(manifest):
    """The libraries a program may reach for, grouped as ``Cargo.toml`` groups them.

    Two sources, one file. The third-party crates are the dependencies declared under a
    ``# --- heading ---`` in ``[dependencies]``, which is the same marker ``build.sh`` reads to decide
    which crates get an ``--extern`` — so what a model is told it may use and what the compile lets it
    name are one declaration. The standard library's group is the ``standard-library`` list under
    ``[package.metadata.gg]``, which is a pointer list rather than a set: ``std`` is not a dependency
    and nothing in this repository decides what is in it.
    """
    groups = []
    section = None
    heading = None
    standard = []
    for line in manifest.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            section = stripped
            continue
        if section == "[dependencies]":
            if stripped.startswith("# --- "):
                heading = stripped.removeprefix("# --- ").removesuffix(" ---").strip()
                groups.append({"group": heading, "modules": []})
            elif heading and re.match(r"^[A-Za-z0-9_-]+ *=", stripped):
                groups[-1]["modules"].append(stripped.split("=")[0].strip().replace("-", "_"))
        elif section == "[package.metadata.gg]":
            found = re.match(r'^"([^"]+)",?$', stripped)
            if found:
                standard.append(found.group(1))
    if not groups or any(not group["modules"] for group in groups):
        raise Failure("`[dependencies]` declares a `# --- heading ---` with nothing under it")
    if not standard:
        raise Failure("`[package.metadata.gg]` declares no `standard-library` list")
    # Last, because it is the group a model needs to be told about least and the one that is longest.
    groups.append({"group": "The standard library, always in scope", "modules": standard})
    return groups


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    document, manifest, out = (Path(argument) for argument in sys.argv[1:])
    docs = Docs(json.loads(document.read_text()))
    catalogued = Reflector(docs).build(libraries_of(manifest))
    out.write_text(json.dumps(catalogued, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        raise SystemExit(f"error: {failure}")
