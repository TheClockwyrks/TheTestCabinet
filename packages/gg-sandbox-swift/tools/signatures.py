#!/usr/bin/env python3
"""Reflect the **Swift** program language's signature catalogue out of the SDK's own documentation,
and write it to the ``swift.signatures.json`` the caller names.

WHERE IT GOES. The destination is an argument, given by ``signatures.sh`` out of
``GG_SIGNATURES_OUT_DIR``, and nothing here has a default: the catalogue is a build artifact that
``crates/gg/build.rs`` generates into the build's own ``OUT_DIR``, and it is committed nowhere.

WHY A SYMBOL GRAPH. ``swiftc -emit-symbol-graph`` is the machinery DocC itself is built on, and it is
what reads all of this SDK at once: for every public declaration it emits the doc comment verbatim,
the RESOLVED type of every parameter and result (with a mangled identifier that says which
declaration each type is), the parameter list with each argument's label and internal name, and the
rendered declaration a reader sees. Nothing here is prose typed into a table.

WHY THE OPERATION ID IS A DOC-COMMENT LINE. gg's identity for a call — that ``files.readFile`` **is**
gg's ``files.read_file`` operation, the same capability Rust spells ``files::read_file`` — is the one
thing Swift's own syntax cannot say. Swift has no user-defined declaration attribute short of a
macro, so the id is written where DocC's own per-argument documentation is written: as a callout line
in the declaration's doc comment, ``- ggop: files.read_file``. Measured against the pinned toolchain
rather than assumed — swiftc emits it as its own line of ``docComment.lines``, unsplit, and warns
about nothing. It is stripped before any prose reaches a model, exactly as ``- Parameter`` is.

WHY ``- Parameter`` IS STILL PARSED. Swift's per-parameter documentation is a **convention over the
doc comment** rather than a slot in the syntax: ``- Parameter path:`` for one argument, or a
``- Parameters:`` block with an indented entry each. The graph hands the comment back as text, so
this file reads the convention — and holds it to being a contract rather than a habit: a function
that takes N arguments must document N, in order, under the names a CALL SITE writes, or the
reflection fails. The failure lands on the author rather than on a model.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
written on a declaration or text lifted out of a doc comment. A blank anywhere is an error.

Usage (through ``signatures.sh``, which emits the graph first):

    signatures.py <gg.symbols.json> <libraries.txt> <package-root> <out.json>
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogue  # noqa: E402  (the module table, beside this file)

#: The schema this catalogue is written in — the normalized doc model: modules, operations,
#: fully-qualified names, authored briefs and resolved type references.
SCHEMA = 2

#: What the emitted catalogue records itself as reflected from.
GENERATED_FROM = "packages/gg-sandbox-swift/Sources/SDK/ (swiftc -emit-symbol-graph)"

#: The types every call's failure arm refers to, closed over on every entry because every fallible
#: function in this SDK throws a ``core.ToolError`` — including the one that cannot fail, whose
#: declaration says so by not being ``throws`` at all.
ALWAYS_REFERENCED = ("gg.core.ToolError", "gg.core.ToolErrorCode")

#: The mangling prefix every declaration of THIS module carries. ``s:`` is Swift's mangled-name
#: marker and ``2gg`` is the module name length-prefixed, so a ``preciseIdentifier`` starting with it
#: names something this SDK declared, and one that does not names ``String``, ``Int``, ``Array`` or
#: another module's type, which are not this catalogue's to describe.
MODULE_PREFIX = "s:2gg"


class Failure(Exception):
    """Something a model would have read is missing, or says something the code does not."""


# ------------------------------------------------------------------------------------------------
# The graph
# ------------------------------------------------------------------------------------------------


class Graph:
    """One ``gg.symbols.json``, indexed the way this reflector walks it.

    Only this SDK's own **public** declarations are kept. The graph also carries every C declaration
    the bridging header brought in — the whole generated WIT surface, which is the one part of this
    package a model never reads — and this SDK's internal wire constructors; filtering on the
    mangling prefix and the access level removes both, and does it by what the compiler said rather
    than by a naming convention anyone could break.
    """

    def __init__(self, document, root):
        self.root = root
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

    def children(self, owner, kind):
        """Every declaration one level under `owner` of one symbol kind, in declaration order.

        Declaration order is the graph's order, which is source order within a file — which is what
        a reader of the SDK sees and therefore what a model should be shown.
        """
        depth = len(owner) + 1
        return [
            symbol
            for path, symbol in self.symbols.items()
            if len(path) == depth
            and path[: len(owner)] == owner
            and symbol["kind"]["identifier"] == kind
        ]

def base_name(title):
    """``readFile(_:offset:limit:)`` → ``readFile``."""
    return title.split("(", 1)[0]


# ------------------------------------------------------------------------------------------------
# Documentation text
# ------------------------------------------------------------------------------------------------

#: One entry of a ``- Parameters:`` block, or a whole ``- Parameter name:`` line.
_PARAMETERS_BLOCK = re.compile(r"^\s*-\s*Parameters:\s*$")
_PARAMETER_LINE = re.compile(r"^\s*-\s*Parameter\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")
_PARAMETER_ENTRY = re.compile(r"^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")

#: The two callouts that are part of what a model READS about a function rather than metadata about
#: its arguments. They stay in the description and land in the detail, exactly as the Rust arm's
#: ``# Errors`` heading does.
_KEPT_CALLOUT = re.compile(r"^\s*-\s*(Returns|Throws)\s*:")

#: Any list item at all, which is what ENDS the wrapped description of the item above it: a doc
#: comment's callouts are one Markdown list, so the next ``- `` starts a new subject whatever that
#: subject turns out to be — another argument, a ``- Returns:``, or one of gg's own tags.
_ITEM = re.compile(r"^\s*-\s+\S")

#: What a finished sentence ends with. Read by the completeness check below rather than by anything
#: that renders, so it is about whether a description ARRIVED whole and not about house style. The
#: three are what every one of this SDK's argument descriptions really ends in, measured rather than
#: chosen — a wider set would be a rule with a hole in it.
_TERMINAL = (".", "?", "!")

#: gg's own callouts, which are identity rather than prose: the operation a declaration binds, the
#: operation it is a second spelling of, and which of gg's modules a namespace is.
_TAG = re.compile(r"^\s*-\s*(ggop|ggop-alias|ggmodule)\s*:\s*(\S+)\s*$")


def doc_lines(symbol):
    """A symbol's doc comment as a list of lines, or ``[]`` when it has none."""
    comment = symbol.get("docComment")
    if not comment:
        return []
    return [line["text"] for line in comment["lines"]]


def read(symbol, what):
    """One doc comment, split into everything that reads it differently.

    Returns ``(description_lines, [(name, description)], {tag: value})``. Everything that is not a
    parameter entry and not one of gg's own tags stays in the description, in order — including
    ``- Returns:`` and ``- Throws:``, which are what a model needs in order to know what it gets and
    which failures to expect.

    WHY THERE ARE TWO PIECES OF STATE. Swift's convention has two forms and only one of them is a
    block, so "am I inside a ``- Parameters:`` block" and "may the argument above still be being
    written" are different questions. A ``- Parameter path:`` line answers the second yes and the
    first no — and reading it as though the two were one is how a wrapped description ends up cut at
    the author's line break, with its remainder left in the function's own prose as an orphan
    sentence. Both forms wrap; both are joined here.
    """
    description = []
    parameters = []
    tags = {}
    in_block = False
    wrapped = False
    for line in doc_lines(symbol):
        tag = _TAG.match(line)
        if tag:
            # Checked FIRST, and before the parameter entries: a tag written after a
            # `- Parameters:` block has the shape of one of its entries, and reading `- ggop:` as an
            # argument called `ggop` is how a function ends up documenting one argument more than it
            # takes.
            if tag.group(1) in tags:
                raise Failure(f"{what} carries two `{tag.group(1)}` tags")
            tags[tag.group(1)] = tag.group(2)
            in_block = wrapped = False
            continue
        matched = _PARAMETER_LINE.match(line)
        if matched:
            in_block = False
            wrapped = True
            parameters.append([matched.group(1), matched.group(2).strip()])
            continue
        if _PARAMETERS_BLOCK.match(line):
            in_block, wrapped = True, False
            continue
        if in_block:
            if not line.strip() or _KEPT_CALLOUT.match(line):
                in_block = wrapped = False
                description.append(line)
                continue
            entry = _PARAMETER_ENTRY.match(line)
            if entry:
                parameters.append([entry.group(1), entry.group(2).strip()])
                wrapped = True
                continue
            if parameters:
                # A continuation line of the entry above it, which is how a long argument
                # description is wrapped.
                parameters[-1][1] += " " + line.strip()
                continue
            raise Failure(f"{what}: a `- Parameters:` block carries a line that is not an entry")
        if wrapped:
            # The rest of a standalone `- Parameter name:` line. It ends at a blank line or at the
            # next list item, both of which are a new subject; anything else is the same sentence,
            # wrapped to the source's line width.
            if line.strip() and not _ITEM.match(line):
                parameters[-1][1] += " " + line.strip()
                continue
            wrapped = False
        description.append(line)
    documented = [(name, prose([text])) for name, text in parameters]
    for name, text in documented:
        # Completeness, which is the one thing about a per-argument description no downstream gate
        # can ask: the register gate holds its SHAPE — that it is there, that it is not blank, that
        # it names an argument the signature takes — and a description truncated mid-sentence
        # satisfies every one of those. A finished sentence ends in punctuation, so a description
        # that does not is one that arrived in pieces.
        if text and not text.endswith(_TERMINAL):
            raise Failure(
                f"{what}'s `{name}` is documented with `{text}`, which does not end a sentence — a "
                "per-argument description that stops mid-clause is one that was cut on the way out "
                "of the doc comment rather than one an author finished"
            )
    return description, documented, tags


def prose(lines):
    """Doc-comment lines as a model reads them: paragraphs joined, structure kept.

    A ``///`` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading Swift rather than anything a model should be shown: they turn one sentence into three
    lines in a documentation view and make a diff of the catalogue a diff of where the author's
    editor wrapped. Blank lines, list items and fenced blocks all survive — the first two because
    they are structure, the third because whitespace inside it is the code.

    It is also what makes the **brief** a single line without the author having to keep one inside
    the source's line width: the brief is the first paragraph, and a paragraph is one line by the
    time it leaves here.
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


def split(text, what):
    """One piece of settled prose as ``(brief, detail)``: the first paragraph, and the rest.

    Doxygen's implicit structure, which is the whole of the convention this SDK is written to. The
    brief is authored rather than derived — there is no "first sentence of" anywhere in this file —
    and the split is on the blank line the author put there, so a doc comment whose opening
    paragraph is really three sentences of narrative fails the register gate as the paragraph it is
    rather than being silently cut at a full stop.
    """
    if not text:
        raise Failure(f"{what} has no documentation")
    brief, _, detail = text.partition("\n\n")
    return brief.strip(), (detail.strip() or None)


def documented(symbol, what):
    """One declaration's ``(brief, detail)``, with its parameter entries and gg's tags left out."""
    description, _, _ = read(symbol, what)
    return split(prose(description), what)


# ------------------------------------------------------------------------------------------------
# Declarations
# ------------------------------------------------------------------------------------------------

#: A declaration attribute, which the rendered declaration carries in front of the keyword.
_ATTRIBUTE = re.compile(r"^(@[A-Za-z_][A-Za-z0-9_]*\s+)+")

#: The accessor clause a computed property's rendered declaration ends with, which says how the
#: property is implemented rather than what its type is.
_ACCESSORS = re.compile(r"\s*\{[^}]*\}\s*$")


class Declared:
    """One type this SDK declares, and the two names it answers to.

    ``fqn`` is the key a documentation view is opened by; ``spelled`` is what a signature writes,
    which is the module-qualified form a program can copy out of one — `files.FileRead` rather than
    a bare `FileRead`, because a bare name resolves only inside the module that declares it.
    """

    def __init__(self, module, symbol):
        self.module = module
        self.symbol = symbol
        self.name = symbol["pathComponents"][1]
        self.spelled = f"{module.name}.{self.name}"
        self.fqn = f"{module.path}.{self.name}"


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
    arguments = []
    depth = 0
    current = ""
    for character in declaration[start + 1 : end]:
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
    """The value an argument takes when it is left out, or ``None`` for a required one.

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


# ------------------------------------------------------------------------------------------------
# The reflection
# ------------------------------------------------------------------------------------------------


class Reflector:
    def __init__(self, graph):
        self.graph = graph
        self.modules = {}
        self.module_precise = set()
        self.declared = {}
        self.types = {}
        self.member_functions = {}
        self.collect()

    # -- indexing --------------------------------------------------------------------------------

    def collect(self):
        """Index the SDK: its capability namespaces, and every type they declare.

        A type is catalogued exactly when a **catalogued module declares it**, which is what makes
        every fully-qualified name in this artifact a real Swift path. It is also what keeps the
        bridging header's own declarations out, on top of the mangling filter: nothing the generated
        C surface declares is nested inside one of these twelve.
        """
        by_name = {module.name: module for module in catalogue.MODULES}
        seen = {}
        for path, symbol in self.graph.symbols.items():
            if len(path) != 1 or symbol["kind"]["identifier"] != "swift.enum":
                continue
            _, _, tags = read(symbol, f"`{path[0]}`")
            id_ = tags.get("ggmodule")
            if id_ is None:
                continue
            if id_ in seen:
                raise Failure(f"two namespaces claim gg's `{id_}` module")
            seen[id_] = path[0]
            module = by_name.get(path[0])
            if module is None or module.id != id_:
                raise Failure(
                    f"`{path[0]}` declares itself gg's `{id_}` module, which `catalogue.py` does "
                    "not name it — the table and the declarations must agree in both directions"
                )
            self.modules[module.id] = symbol
            self.module_precise.add(symbol["identifier"]["precise"])

        missing = [module.id for module in catalogue.MODULES if module.id not in self.modules]
        if missing:
            raise Failure(f"`catalogue.py` names modules no namespace declares itself to be: {missing}")

        for module in catalogue.MODULES:
            for kind in ("swift.struct", "swift.enum"):
                for symbol in self.graph.children((module.name,), kind):
                    declared = Declared(module, symbol)
                    self.declared[symbol["identifier"]["precise"]] = declared

    # -- rendering -------------------------------------------------------------------------------

    def render(self, fragments):
        """One list of declaration fragments as the text a model reads.

        Two substitutions, and both are about the ONE spelling of a type a program can copy out of a
        signature. The compiler renders a nested type bare inside its own namespace (`FileRead`) and
        qualified outside it (`files.FileRead`), which would show a model two names for one type and
        one of them unresolvable; so a namespace used as a qualifier is dropped with the `.` that
        follows it, and every declared type is then written under its own module-qualified spelling.
        """
        items = [[fragment["spelling"], fragment.get("preciseIdentifier")] for fragment in fragments]
        out = []
        index = 0
        while index < len(items):
            spelling, precise = items[index]
            if (
                precise in self.module_precise
                and index + 1 < len(items)
                and items[index + 1][0].startswith(".")
            ):
                items[index + 1][0] = items[index + 1][0][1:]
                index += 1
                continue
            if precise in self.declared:
                spelling = self.declared[precise].spelled
            out.append(spelling)
            index += 1
        return "".join(out)

    def referenced(self, fragments, out):
        """Every declared type a fragment list mentions, by precise identifier, in mention order."""
        for fragment in fragments:
            precise = fragment.get("preciseIdentifier")
            if precise in self.declared:
                out.append(precise)

    # -- types -----------------------------------------------------------------------------------

    def declare(self, precise):
        """Record one type's declaration, once, and hand back the identifiers its members mention."""
        if precise in self.types:
            return self.types[precise]["referenced"]
        declared = self.declared[precise]
        owner = (declared.module.name, declared.name)
        what = f"the type `{declared.fqn}`"
        kind = declared.symbol["kind"]["identifier"]
        members = []
        parts = []
        referenced = []
        if kind == "swift.struct":
            for member in self.graph.children(owner, "swift.property"):
                rendered = self.render(member["declarationFragments"])
                self.referenced(member["declarationFragments"], referenced)
                parts.append(rendered)
                members.append(
                    self.member(member, "field", member_type(rendered), declared)
                )
            if not members:
                raise Failure(f"`{declared.fqn}` is a struct with no public properties")
            declaration = f"struct {declared.name} {{ " + "; ".join(parts) + " }"
        elif kind == "swift.enum":
            for member in self.graph.children(owner, "swift.enum.case"):
                rendered = self.render(member["declarationFragments"])
                self.referenced(member["declarationFragments"], referenced)
                parts.append(rendered)
                carried = (
                    rendered.split("(", 1)[1].rsplit(")", 1)[0] if "(" in rendered else None
                )
                members.append(self.member(member, "variant", carried, declared))
            if not members:
                raise Failure(f"`{declared.fqn}` is an enum with no cases, which a model cannot use")
            declaration = f"enum {declared.name} {{ " + "; ".join(parts) + " }"
        else:
            raise Failure(f"`{declared.fqn}` is a {kind}, which this catalogue cannot render")

        brief, detail = documented(declared.symbol, what)
        self.types[precise] = {
            "fqn": declared.fqn,
            "module": declared.module.id,
            "name": declared.name,
            "declaration": declaration,
            "brief": brief,
            "detail": detail,
            "members": members,
            "memberFunctions": [],
            "referenced": referenced,
        }
        return referenced

    def member(self, symbol, kind, rendered, declared):
        """One property or case, with the documentation written on it.

        The **base** name for a case, because a case that carries a value is spelled `set(_:)` in
        the graph and written `.set(…)` in a program — and what a model needs is the name it writes,
        with the type it carries beside it rather than folded into it.
        """
        name = base_name(symbol["pathComponents"][2])
        brief, detail = documented(symbol, f"`{declared.fqn}.{name}`")
        return {"name": name, "type": rendered, "kind": kind, "brief": brief, "detail": detail}

    def close_over(self, identifiers):
        """The declared types a signature mentions, transitively closed, in first-mention order.

        Transitive because the list answers *which declarations does this run's surface reach*,
        which is what decides whether a type may be opened at all. What a documentation view opens
        beside a function is a **depth-one** question gg answers for itself, so widening here costs
        nothing there.
        """
        pending = list(identifiers)
        seen = []
        while pending:
            precise = pending.pop(0)
            if precise in seen or precise not in self.declared:
                continue
            seen.append(precise)
            pending.extend(self.declare(precise))
        return seen

    def references(self, identifiers):
        """A list of precise identifiers, as the resolved type references the catalogue carries."""
        out = []
        for precise in identifiers:
            declared = self.declared[precise]
            out.append({"spelled": declared.spelled, "fqn": declared.fqn})
        return out

    def always_referenced(self):
        """The identifiers of the types every failure arm names, looked up rather than written down."""
        found = []
        for fqn in ALWAYS_REFERENCED:
            matched = [
                precise for precise, declared in self.declared.items() if declared.fqn == fqn
            ]
            if len(matched) != 1:
                raise Failure(f"`{fqn}` is declared {len(matched)} times, and must be declared once")
            found.append(matched[0])
        return found

    # -- functions -------------------------------------------------------------------------------

    def signature(self, symbol, name, what):
        """One function's single calling shape, and the arguments it documents.

        Swift has overloads and this SDK deliberately uses none: an optional argument is a **default
        value**, which is the language's own idiom and is what a Swift author reads at the call
        site. So an entry always carries exactly one shape — where Java's carries one per overload.
        The count is spelling; nothing downstream compares it.
        """
        declaration = self.render(symbol["declarationFragments"])
        # Attributes first. `@discardableResult` is on every call whose result a program may
        # reasonably ignore, and it is a fact about the compiler's warnings rather than about the
        # surface — a model shown it would read it as something it has to write.
        declaration = _ATTRIBUTE.sub("", declaration).strip()
        # What is left begins `static func …` for a type method and `func …` for a member one. What
        # the catalogue shows starts at the name a program writes, exactly as every other arm's
        # does, which is also what the agreement gate holds every entry to.
        for prefix in ("static func ", "func "):
            if declaration.startswith(prefix):
                declaration = declaration[len(prefix) :]
                break
        else:
            raise Failure(f"{what}: `{declaration}` is not a function declaration")

        declared = symbol.get("functionSignature", {}).get("parameters", [])
        written = split_arguments(declaration, what) if declared else []
        if len(written) != len(declared):
            raise Failure(
                f"{what}: the rendered declaration has {len(written)} arguments and the signature "
                f"{len(declared)}"
            )
        _, documented_arguments, _ = read(symbol, what)
        if len(documented_arguments) != len(declared):
            raise Failure(
                f"{what} takes {len(declared)} arguments and documents "
                f"{len(documented_arguments)} — Swift's per-argument documentation is a convention "
                "over the doc comment, so every argument must appear under `- Parameter <name>:` or "
                "in a `- Parameters:` block, in order"
            )

        parameters = []
        for (label, description), argument, parameter in zip(
            documented_arguments, written, declared
        ):
            # `name` is what a CALL SITE writes: the argument label, or — where the label is `_` —
            # the internal name, which is what the graph reports under `name` either way.
            api_name = parameter["name"]
            if label != api_name:
                raise Failure(
                    f"{what} documents `{label}` where its signature takes `{api_name}` — a renamed "
                    "argument left behind in the documentation tells a model to write something the "
                    "call will not accept"
                )
            if not description:
                raise Failure(f"{what}'s `{api_name}` has no description")
            kind = self.render(parameter["declarationFragments"])
            kind = kind.split(":", 1)[1].strip() if ":" in kind else kind
            default = default_of(argument)
            parameters.append(
                {
                    "name": api_name,
                    "type": kind,
                    # A Swift argument with a default value may be left out; one without may not.
                    # There is no other way to omit one — Swift has no variadic options record and
                    # no keyword dictionary — so the default IS the optionality.
                    "optional": default is not None,
                    # Every Swift argument is positional, label or no label: the labels are part of
                    # the function's name rather than a way of reordering a call.
                    "kind": "positional",
                    "default": default,
                    "doc": description,
                    # Always empty: every structured argument in this SDK is typed by NAME, and that
                    # type is catalogued with its own documented members. Filling both would be two
                    # copies of one sentence with nothing keeping them equal.
                    "fields": [],
                }
            )
        return {
            "signature": f"{name}{declaration[declaration.find('(') :]}",
            "parameters": parameters,
        }

    def entry(self, symbol, module, operation, alias_of, receiver=None):
        """One catalogued call, whatever kind of declaration the SDK made of it."""
        name = base_name(symbol["pathComponents"][-1])
        fqn = (
            f"{module.path}.{receiver}.{name}" if receiver is not None else f"{module.path}.{name}"
        )
        what = f"`{fqn}`"
        shape = self.signature(symbol, name, what)
        signature = symbol.get("functionSignature", {})
        argument_ids = []
        for parameter in signature.get("parameters", []):
            self.referenced(parameter["declarationFragments"], argument_ids)
        returned_ids = []
        self.referenced(signature.get("returns", []), returned_ids)
        brief, detail = documented(symbol, what)
        return {
            "operation": operation,
            "aliasOf": alias_of,
            "module": module.id,
            "kind": "method" if receiver is not None else "static-method",
            "receiver": receiver,
            "name": name,
            "fqn": fqn,
            # `null`, because on this arm the fully-qualified name IS what a program writes: `gg` is
            # the Swift module the SDK is compiled into and each namespace is a real declaration in
            # it, so `gg.files.readFile(…)` is the same call as `files.readFile(…)` written in full.
            "call": None,
            "brief": brief,
            "detail": detail,
            "signatures": [shape],
            # The closure runs first, because it is what records the declarations both lists then
            # name; `returns` itself is the DIRECT return position and nothing beyond it, since what
            # it feeds is a one-level rule.
            "types": self.references(
                self.close_over(argument_ids + returned_ids + self.always_referenced())
            ),
            "returns": self.references(deduped(returned_ids)),
        }

    def functions_and_members(self):
        """Every catalogued call, module by module, with the member functions collected beside them.

        The member walk runs **after** the module walk and over the declared types rather than out
        of the type renderer, deliberately: a member function is a real declaration with its own
        operation id, its own signature and its own documentation, and a renderer that listed a
        type's methods from the type would emit entries nobody had written an id on. It is also why
        the type renderer above enumerates properties and cases only.
        """
        functions = []
        for module in catalogue.MODULES:
            for symbol in self.graph.children((module.name,), "swift.type.method"):
                name = base_name(symbol["pathComponents"][1])
                what = f"`{module.path}.{name}`"
                _, _, tags = read(symbol, what)
                operation, alias_of = self.identify(tags, what)
                functions.append(self.entry(symbol, module, operation, alias_of))

        # The members, over the types the modules declare. Each one is emitted twice on purpose:
        # once as a catalogued call, because it is one, and once as a line on its receiver's own
        # documentation view, which is the menu a model reads when it opens the type.
        for precise, declared in self.declared.items():
            owner = (declared.module.name, declared.name)
            for symbol in self.graph.children(owner, "swift.method"):
                name = base_name(symbol["pathComponents"][2])
                what = f"`{declared.fqn}.{name}`"
                _, _, tags = read(symbol, what)
                # Identified on exactly the terms a module function is, and deliberately not skipped
                # when it carries no id. A member function is as much a capability as a free one —
                # `handle.send(…)` IS `delegation.send_to_subagent` — so an untagged one is a
                # capability no model is ever told about, behind a catalogue that is still
                # well-formed and gates that all still pass. Silence is the shape of defect this
                # reflector exists to make impossible, so the absence of a tag fails by name here
                # rather than dropping the declaration.
                operation, alias_of = self.identify(tags, what)
                entry = self.entry(symbol, declared.module, operation, alias_of, declared.name)
                functions.append(entry)
                self.member_functions.setdefault(precise, []).append(
                    {
                        "operation": entry["operation"],
                        "name": entry["name"],
                        "fqn": entry["fqn"],
                        "brief": entry["brief"],
                    }
                )
        return functions

    @staticmethod
    def identify(tags, what):
        """The operation a declaration binds, and the one it is a second spelling of.

        The check runs in **both** directions the register gate cannot: a model-facing declaration
        with no id at all fails here, and an id gg does not have fails in `language/register.rs`
        against the operations table. Between them there is no way to ship a function a model is
        never told it has.
        """
        operation = tags.get("ggop")
        alias_of = tags.get("ggop-alias")
        if operation is None and alias_of is None:
            raise Failure(
                f"{what} is public and names no gg operation, so a model would never be told it "
                "exists — write `- ggop: <namespace>.<key>` in its doc comment"
            )
        if operation is not None and alias_of is not None:
            raise Failure(f"{what} is both an operation and an alias of one")
        return operation or alias_of, alias_of

    # -- the whole document ----------------------------------------------------------------------

    def modules_section(self):
        """Each module's own brief and detail."""
        out = []
        for module in catalogue.MODULES:
            symbol = self.modules[module.id]
            brief, detail = documented(symbol, f"the `{module.path}` module")
            out.append(
                {
                    "id": module.id,
                    "path": module.path,
                    "brief": brief,
                    "detail": detail,
                    # `null`, and truthfully: gg's own shell re-exports this SDK into the program's
                    # module with `@_exported import gg`, so there is no import line a program would
                    # be right to write.
                    "import": None,
                }
            )
        return out

    def build(self, libraries):
        functions = self.functions_and_members()
        # The member functions are folded into their receivers by the walk above, so the type
        # declarations are finished last — after every entry that could add a line to one.
        for precise in list(self.types):
            self.types[precise]["memberFunctions"] = self.member_functions.get(precise, [])
        return {
            "schema": SCHEMA,
            "language": "swift",
            "generatedFrom": GENERATED_FROM,
            "libraries": libraries,
            "modules": self.modules_section(),
            "functions": functions,
            "types": [
                {key: value for key, value in declaration.items() if key != "referenced"}
                for _, declaration in sorted(
                    self.types.items(), key=lambda pair: pair[1]["fqn"]
                )
            ],
        }


def member_type(rendered):
    """The type of a rendered property declaration: `let contents: String` → `String`.

    A computed property's accessor clause comes off with it: `var description: String { get }` is a
    `String` to every reader that matters, and the braces say how it is implemented rather than what
    it is.
    """
    if ":" not in rendered:
        return None
    return _ACCESSORS.sub("", rendered.split(":", 1)[1]).strip()


def deduped(identifiers):
    """`identifiers` with every repeat dropped, in first-mention order."""
    out = []
    for precise in identifiers:
        if precise not in out:
            out.append(precise)
    return out


# ------------------------------------------------------------------------------------------------
# The library set
# ------------------------------------------------------------------------------------------------


def libraries_of(manifest):
    """The modules a program may ``import``, grouped as ``libraries.txt`` groups them.

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
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    document, manifest, root, out = (Path(argument) for argument in sys.argv[1:])
    graph = Graph(json.loads(document.read_text()), root)
    catalogued = Reflector(graph).build(libraries_of(manifest))
    out.write_text(json.dumps(catalogued, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        raise SystemExit(f"error: {failure}")
