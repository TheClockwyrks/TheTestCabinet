#!/usr/bin/env python3
"""Reflect the **Swift** program language's signature catalogue out of the SDK's own documentation,
and write it to ``crates/gg/src/sandbox/guests/swift.signatures.json``.

WHY A SYMBOL GRAPH. ``swiftc -emit-symbol-graph`` is the machinery DocC itself is built on, and it
is what reads all of this SDK at once: for every public declaration it emits the doc comment
verbatim, the RESOLVED type of every parameter and result (with a mangled identifier that says which
module each type came from), the parameter list with each argument's label and internal name, and
the rendered declaration a reader sees. Nothing here is prose typed into a table.

WHY THE PARAMETER PROSE IS STILL PARSED. Swift's per-parameter documentation is a **convention over
the doc comment** rather than a slot in the syntax: ``- Parameter path:`` for one argument, or a
``- Parameters:`` block with an indented entry each. The graph hands the comment back as text, so
this file reads the convention — and holds it to being a contract rather than a habit: a function
that takes N arguments must document N, in order, under the names a CALL SITE writes, or the
reflection fails. The failure lands on the author rather than on a model.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
from ``catalogue.py`` (a tool name, an object, a gate) or text lifted out of a doc comment. A blank
anywhere is an error.

Usage (through ``signatures.sh``, which emits the graph first):

    signatures.py <gg.symbols.json> <libraries.txt> <out.json>
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogue  # noqa: E402  (the identity table, beside this file)

#: What the emitted catalogue records itself as reflected from.
GENERATED_FROM = "packages/gg-sandbox-swift/Sources/SDK/ (swiftc -emit-symbol-graph)"

#: The types every call's failure arm refers to, added to every entry's `types` because every
#: function in this SDK is `throws` and what it throws is a `ToolError` — including the two that
#: cannot fail, whose declaration says so by not being `throws` at all.
ALWAYS_REFERENCED = ("ToolError", "ToolErrorCode")

#: The mangling prefix every type declared by THIS module carries. `s:` is Swift's mangled-name
#: marker, `2gg` is the module name length-prefixed — so a `preciseIdentifier` starting with it names
#: something this SDK declared, and one that does not names `String`, `Int`, `Array` or another
#: module's type, which are not this catalogue's to describe.
MODULE_PREFIX = "s:2gg"


class Failure(Exception):
    """Something a model would have read is missing, or says something the code does not."""


# ------------------------------------------------------------------------------------------------
# The graph
# ------------------------------------------------------------------------------------------------


class Graph:
    """One ``gg.symbols.json``, indexed the way this reflector walks it.

    Only this module's own **public** declarations are kept. The graph also carries every C
    declaration the bridging header brought in — the whole generated WIT surface, which is the one
    part of this package a model never reads — and this SDK's internal wire constructors; filtering
    on the mangling prefix and the access level removes both, and does it by what the compiler said
    rather than by a naming convention anyone could break.
    """

    def __init__(self, document):
        self.symbols = {}
        for symbol in document["symbols"]:
            if not symbol["identifier"]["precise"].startswith(MODULE_PREFIX):
                continue
            if symbol.get("accessLevel") != "public":
                continue
            self.symbols[tuple(symbol["pathComponents"])] = symbol
        self.by_precise = {
            symbol["identifier"]["precise"]: symbol for symbol in self.symbols.values()
        }

    def type_named(self, name):
        """One top-level type declaration, by name."""
        return self.symbols.get((name,))

    def members_of(self, owner, kind):
        """Every member of `owner` of one symbol kind, in declaration order.

        Declaration order is the graph's order, which is source order within a file — which is what
        a reader of the SDK sees and therefore what a model should be shown.
        """
        return [
            symbol
            for path, symbol in self.symbols.items()
            if len(path) == 2 and path[0] == owner and symbol["kind"]["identifier"] == kind
        ]

    def method(self, owner, name):
        """One method of `owner` whose base name is `name`.

        Swift's own name for a function includes its argument labels (`readFile(_:offset:limit:)`),
        and the catalogue's `name` is the base alone — because the base is what a program writes
        before the parenthesis and what `view.openDocsView` is keyed on. There is exactly one method
        per base name in this SDK; a second would be an overload group, which is a shape the
        catalogue can carry and this arm does not use.
        """
        found = [
            symbol
            for path, symbol in self.symbols.items()
            if len(path) == 2
            and path[0] == owner
            and symbol["kind"]["identifier"] == "swift.type.method"
            and base_name(path[1]) == name
        ]
        if len(found) > 1:
            raise Failure(f"`{owner}.{name}` is declared more than once")
        return found[0] if found else None


def base_name(title):
    """`readFile(_:offset:limit:)` → `readFile`."""
    return title.split("(", 1)[0]


def rendered(fragments):
    """One list of declaration fragments as the text a reader sees."""
    return "".join(fragment["spelling"] for fragment in fragments)


# ------------------------------------------------------------------------------------------------
# Documentation text
# ------------------------------------------------------------------------------------------------

#: One entry of a `- Parameters:` block, or a whole `- Parameter name:` line.
_PARAMETERS_BLOCK = re.compile(r"^\s*-\s*Parameters:\s*$")
_PARAMETER_LINE = re.compile(r"^\s*-\s*Parameter\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")
_PARAMETER_ENTRY = re.compile(r"^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")

#: The two callouts that are part of what a model should READ about a function rather than metadata
#: about its arguments, so they stay in the description exactly as `# Errors` does on the Rust arm.
_KEPT_CALLOUT = re.compile(r"^\s*-\s*(Returns|Throws)\s*:")


def doc_lines(symbol):
    """A symbol's doc comment as a list of lines, or `[]` when it has none."""
    comment = symbol.get("docComment")
    if not comment:
        return []
    return [line["text"] for line in comment["lines"]]


def split_documentation(lines):
    """A doc comment split into its description and its per-parameter entries.

    Returns ``(description_lines, [(name, description)])``. Everything that is not part of a
    parameter callout stays in the description, in order — including ``- Returns:`` and
    ``- Throws:``, which are what a model needs in order to know what it gets and which failures to
    expect.
    """
    description = []
    parameters = []
    in_block = False
    for line in lines:
        matched = _PARAMETER_LINE.match(line)
        if matched:
            in_block = False
            parameters.append([matched.group(1), matched.group(2).strip()])
            continue
        if _PARAMETERS_BLOCK.match(line):
            in_block = True
            continue
        if in_block:
            if not line.strip():
                in_block = False
                description.append(line)
                continue
            # Checked BEFORE an entry, because `- Returns: …` is the shape of an entry too: a
            # `- Parameters:` block ends at the first callout that is not one of its entries, and
            # reading that callout as an argument called `Returns` is how a function ends up
            # documenting two arguments more than it takes.
            if _KEPT_CALLOUT.match(line):
                in_block = False
                description.append(line)
                continue
            entry = _PARAMETER_ENTRY.match(line)
            if entry:
                parameters.append([entry.group(1), entry.group(2).strip()])
                continue
            if parameters:
                # A continuation line of the entry above it, which is how a long argument
                # description is wrapped.
                parameters[-1][1] += " " + line.strip()
                continue
            raise Failure(f"a `- Parameters:` block carries a line that is not an entry: {line!r}")
        description.append(line)
    return description, [(name, prose([text])) for name, text in parameters]


def prose(lines):
    """Doc-comment lines as a model reads them: paragraphs joined, structure kept.

    A `///` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading Swift rather than anything a model should be shown: they turn one sentence into three
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

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            flush()
            fenced = not fenced
            out.append(stripped)
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
    return "\n".join(out).strip()


def described(symbol, what):
    """A symbol's documentation minus its per-argument entries, refusing a blank one."""
    description, _ = split_documentation(doc_lines(symbol))
    text = prose(description)
    if not text:
        raise Failure(f"{what} has no documentation")
    return text


# ------------------------------------------------------------------------------------------------
# Signatures
# ------------------------------------------------------------------------------------------------


#: A declaration attribute, which the rendered declaration carries in front of the keyword.
_ATTRIBUTE = re.compile(r"^(@[A-Za-z_][A-Za-z0-9_]*\s+)+")


def split_arguments(declaration, what):
    """The text between a declaration's outermost parentheses, split on its top-level commas.

    Written rather than borrowed because a Swift parameter's type may itself carry commas —
    `[ClosedRange<Int>]` does not, but a closure or a tuple would — and splitting naively would put
    half a type in one entry and half in the next.
    """
    start = declaration.find("(")
    if start < 0:
        raise Failure(f"{what}: `{declaration}` has no argument list")
    depth = 0
    end = None
    for index in range(start, len(declaration)):
        character = declaration[index]
        if character in "([<{":
            depth += 1
        elif character in ")]>}":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end is None:
        raise Failure(f"{what}: `{declaration}`'s argument list is not closed")
    inner = declaration[start + 1 : end]
    arguments = []
    depth = 0
    current = ""
    for character in inner:
        if character in "([<{":
            depth += 1
        elif character in ")]>}":
            depth -= 1
        if character == "," and depth == 0:
            arguments.append(current.strip())
            current = ""
            continue
        current += character
    if current.strip():
        arguments.append(current.strip())
    return arguments


def default_of(argument):
    """The value an argument takes when it is left out, or `None` for a required one.

    Read out of the rendered declaration, which is the one place the symbol graph records it: a
    parameter's own fragments carry its name and its type and stop there.
    """
    depth = 0
    for index, character in enumerate(argument):
        if character in "([<{":
            depth += 1
        elif character in ")]>}":
            depth -= 1
        elif character == "=" and depth == 0:
            return argument[index + 1 :].strip()
    return None


def signature_of(graph, symbol, name, what):
    """One function's single calling shape, and the arguments it documents.

    Swift has overloads and this SDK deliberately uses none: an optional argument is a **default
    value**, which is the language's own idiom and is what a Swift author reads at the call site.
    So an entry always carries exactly one shape — where Java's carries one per overload. The count
    is spelling; nothing downstream compares it.
    """
    declaration = rendered(symbol["declarationFragments"])
    # Attributes first. `@discardableResult` is on every call whose result a program may reasonably
    # ignore, and it is a fact about the compiler's warnings rather than about the surface — a model
    # shown it would read it as something it has to write.
    declaration = _ATTRIBUTE.sub("", declaration).strip()
    # What is left begins `static func …` for a type method and `func …` for anything else. What the
    # catalogue shows starts at the name a program writes, exactly as every other arm's does.
    for prefix in ("static func ", "func "):
        if declaration.startswith(prefix):
            declaration = declaration[len(prefix) :]
            break
    else:
        raise Failure(f"{what}: `{declaration}` is not a function declaration")

    signature = symbol.get("functionSignature", {})
    declared = signature.get("parameters", [])
    written = split_arguments(declaration, what) if declared else []
    if len(written) != len(declared):
        raise Failure(
            f"{what}: the rendered declaration has {len(written)} arguments and the signature "
            f"{len(declared)}"
        )
    _, documented = split_documentation(doc_lines(symbol))
    if len(documented) != len(declared):
        raise Failure(
            f"{what} takes {len(declared)} arguments and documents {len(documented)} — Swift's "
            "per-argument documentation is a convention over the doc comment, so every argument "
            "must appear under `- Parameter <name>:` or in a `- Parameters:` block, in order"
        )

    parameters = []
    for (label, description), argument, parameter in zip(documented, written, declared):
        # `name` is what a CALL SITE writes: the argument label, or — where the label is `_` — the
        # internal name, which is what the graph reports and what a doc comment names it by.
        api_name = parameter["name"]
        if label != api_name:
            raise Failure(
                f"{what} documents `{label}` where its signature takes `{api_name}` — a renamed "
                "argument left behind in the documentation tells a model to write something the "
                "call will not accept"
            )
        if not description:
            raise Failure(f"{what}'s `{api_name}` has no description")
        kind = rendered(parameter["declarationFragments"])
        kind = kind.split(":", 1)[1].strip() if ":" in kind else kind
        default = default_of(argument)
        parameters.append(
            {
                "name": api_name,
                "type": kind,
                # A Swift argument with a default value may be left out; one without may not. There
                # is no other way to omit one — Swift has no variadic options record and no keyword
                # dictionary — so the default IS the optionality.
                "optional": default is not None,
                # Every Swift argument is positional, label or no label: the labels are part of the
                # function's name rather than a way of reordering a call.
                "kind": "positional",
                "default": default,
                "doc": description,
                # Always empty: every structured argument in this SDK is typed by NAME, and that
                # type is catalogued with its own documented members. Filling both would be two
                # copies of one sentence with nothing keeping them equal.
                "fields": [],
            }
        )
    return {"signature": f"{name}{declaration[declaration.find('(') :]}", "parameters": parameters}


def referenced(symbol):
    """Every type THIS module declares that a function's signature mentions, in mention order.

    Read off the `preciseIdentifier` the compiler resolved rather than off the rendered text, so a
    `String` and a `TextEdit` are told apart by what they are rather than by whether the name
    happens to appear in a table.
    """
    found = []
    signature = symbol.get("functionSignature", {})
    fragments = []
    for parameter in signature.get("parameters", []):
        fragments.extend(parameter["declarationFragments"])
    fragments.extend(signature.get("returns", []))
    for fragment in fragments:
        precise = fragment.get("preciseIdentifier")
        if precise and precise.startswith(MODULE_PREFIX):
            found.append(fragment["spelling"])
    return found


# ------------------------------------------------------------------------------------------------
# Type declarations
# ------------------------------------------------------------------------------------------------


def declaration_of(graph, name, what):
    """One type's declaration and its members, as a model reads them.

    A struct is its public properties and an enum is its cases, each carrying the type it wraps when
    it wraps one. Both are rendered as **real Swift on one line** — `enum EntryKind { case file,
    directory, other }` is a declaration a reader can paste — because a declaration in this
    catalogue is a shape read at a glance and the members carry the meaning.
    """
    symbol = graph.type_named(name)
    if symbol is None:
        raise Failure(f"{what}: the SDK declares no type called `{name}`")
    kind = symbol["kind"]["identifier"]
    members = []
    parts = []
    if kind == "swift.struct":
        for member in graph.members_of(name, "swift.property"):
            declared = rendered(member["declarationFragments"])
            parts.append(declared)
            members.append(
                {
                    "name": member["pathComponents"][1],
                    "type": member_type(declared),
                    "doc": described(member, f"`{name}.{member['pathComponents'][1]}`"),
                }
            )
        return f"struct {name} {{ " + "; ".join(parts) + " }", members
    if kind == "swift.enum":
        for member in graph.members_of(name, "swift.enum.case"):
            declared = rendered(member["declarationFragments"])
            parts.append(declared)
            carried = declared.split("(", 1)[1].rsplit(")", 1)[0] if "(" in declared else None
            members.append(
                {
                    # The base name, because a case that carries a value is spelled `set(_:)` in the
                    # graph and written `.set(…)` in a program — and what a model needs is the name
                    # it writes, with the type it carries beside it rather than folded into it.
                    "name": base_name(member["pathComponents"][1]),
                    "type": carried,
                    "doc": described(member, f"`{name}.{member['pathComponents'][1]}`"),
                }
            )
        if not members:
            raise Failure(f"`{name}` is an enum with no cases, which a model cannot use")
        return f"enum {name} {{ " + "; ".join(parts) + " }", members
    raise Failure(f"`{name}` is a {kind}, which this catalogue cannot render")


def member_type(declared):
    """The type of a rendered property declaration: `let contents: String` → `String`."""
    if ":" not in declared:
        return None
    return declared.split(":", 1)[1].strip()


# ------------------------------------------------------------------------------------------------
# The reflection
# ------------------------------------------------------------------------------------------------


class Reflector:
    def __init__(self, graph):
        self.graph = graph
        self.types = {}
        missing = [name for name in catalogue.OBJECTS if graph.type_named(name) is None]
        if missing:
            raise Failure(f"the catalogue names API objects this SDK has no type for: {missing}")

    def entry(self, spec):
        """One catalogue entry, whatever section it belongs to."""
        what = f"`{spec['object']}.{spec['name']}`"
        symbol = self.graph.method(spec["object"], spec["name"])
        if symbol is None:
            raise Failure(
                f"the catalogue names {what}, which this SDK does not declare as a public method"
            )
        return {
            "name": spec["name"],
            "object": spec["object"],
            "signatures": [signature_of(self.graph, symbol, spec["name"], what)],
            "doc": described(symbol, what),
            "types": self.close_over(referenced(symbol)),
        }

    def close_over(self, names):
        """The SDK's own types a signature mentions, transitively closed, in first-mention order."""
        pending = list(names) + list(ALWAYS_REFERENCED)
        seen = []
        while pending:
            name = pending.pop(0)
            if name in seen or self.graph.type_named(name) is None:
                continue
            seen.append(name)
            self.declare(name)
            for member in self.types[name]["members"]:
                if member["type"]:
                    pending.extend(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", member["type"]))
        return seen

    def declare(self, name):
        """Record one type's declaration, once."""
        if name in self.types:
            return
        rendering, members = declaration_of(self.graph, name, f"the type `{name}`")
        self.types[name] = {
            "name": name,
            "declaration": rendering,
            "doc": described(self.graph.type_named(name), f"the type `{name}`"),
            "members": members,
        }

    def objects_section(self):
        """Each API object's one-line description: the first paragraph of its type's own `///`."""
        out = []
        for name in catalogue.OBJECTS:
            described_text = described(self.graph.type_named(name), f"the `{name}` object")
            first = described_text.split("\n\n")[0].strip()
            if not first:
                raise Failure(f"the `{name}` object has no documentation to introduce it by")
            out.append({"object": name, "doc": first})
        return out

    def meta_section(self):
        """The `list` every API object carries, read from the one place it is declared.

        On this arm there is nothing to compare: `list()` is the default implementation on the
        `ApiObject` protocol every object conforms to, so twelve objects share one declaration and
        one paragraph of documentation by construction rather than by a check.
        """
        owner = catalogue.META_PROTOCOL
        what = f"`{owner}.list`"
        symbol = self.graph.method(owner, "list")
        if symbol is None:
            raise Failure(f"{what} is not declared, so no API object carries a directory")
        return [
            {
                "key": "list",
                "name": "list",
                "signatures": [signature_of(self.graph, symbol, "list", what)],
                "doc": described(symbol, what),
                "types": [
                    found
                    for found in self.close_over(referenced(symbol))
                    if found not in ALWAYS_REFERENCED
                ],
            }
        ]

    def sanity_check(self):
        """Every public method of an API object is named by the identity table, and vice versa.

        The direction that matters is this one: a function added to an object and forgotten in
        `catalogue.py` is a capability a model is never told it has, which no other gate would
        notice.
        """
        named = {(spec["object"], spec["name"]) for spec in catalogue.ENTRIES}
        for object_ in catalogue.OBJECTS:
            for path, symbol in self.graph.symbols.items():
                if len(path) != 2 or path[0] != object_:
                    continue
                if symbol["kind"]["identifier"] != "swift.type.method":
                    continue
                name = base_name(path[1])
                if name == "list":
                    continue
                if (object_, name) not in named:
                    raise Failure(
                        f"`{object_}.{name}` is public and nothing in `catalogue.py` names it, so "
                        "a model would never be told it exists"
                    )

    def build(self, libraries):
        self.sanity_check()
        document = {
            "language": "swift",
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
            if spec["section"] in ("views", "helpers"):
                entry["requires"] = spec["gate"]
            document[spec["section"]].append(entry)
        document["types"] = [self.types[name] for name in sorted(self.types)]
        return document


# ------------------------------------------------------------------------------------------------
# The library set
# ------------------------------------------------------------------------------------------------


def libraries_of(manifest):
    """The modules a program may `import`, grouped as ``libraries.txt`` groups them.

    One declaration with two readers: this, which is what a model is told, and
    `swift_reaches_every_library`, which compiles a program that imports every one of them through
    the real prepare step. A module listed here that the committed archive does not carry fails
    there rather than reaching a model.
    """
    groups = []
    for line in manifest.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("# --- "):
            heading = stripped.removeprefix("# --- ").removesuffix(" ---").strip()
            groups.append({"group": heading, "modules": []})
        elif stripped.startswith("#") or not stripped:
            continue
        elif not groups:
            raise Failure(f"`{stripped}` is declared under no `# --- heading ---`")
        else:
            groups[-1]["modules"].append(stripped)
    if not groups or any(not group["modules"] for group in groups):
        raise Failure("`libraries.txt` declares a `# --- heading ---` with nothing under it")
    return groups


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    document, manifest, out = (Path(argument) for argument in sys.argv[1:])
    graph = Graph(json.loads(document.read_text()))
    catalogued = Reflector(graph).build(libraries_of(manifest))
    out.write_text(json.dumps(catalogued, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        raise SystemExit(f"error: {failure}")
