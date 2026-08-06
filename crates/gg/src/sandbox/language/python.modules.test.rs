//! What a Python code module is read to offer, and — as often — what it is deliberately not.

use super::exports;

/// **A module's definitions are its exports**, in source order, each spelled once.
#[test]
fn a_modules_definitions_are_what_it_offers() {
    let module = "\
HEADER = 'name,size'
TIMEOUT: int = 30


def widen(text, width):
    return text.ljust(width, '.')


async def fetch(url):
    return url


class Row:
    def __init__(self, name):
        # A method is not a module-level definition, however it is spelled.
        self.name = name
";
    assert_eq!(
        exports(module),
        ["HEADER", "TIMEOUT", "widen", "fetch", "Row"]
    );
}

/// **A private name is not offered**, on the language's own convention — the same rule the guest's
/// shim applies when it builds the namespace, so the list gg reports and the names really bound
/// agree.
#[test]
fn an_underscored_name_is_private() {
    assert_eq!(
        exports("_secret = 1\n__all__ = ['x']\nvisible = 2\n"),
        ["visible"]
    );
}

/// **A name a module merely imported is not reported.**
///
/// `import json` really does put `json` into the namespace, so `lib.helpers.json` really does exist.
/// Saying so would be telling a model about a module it can `import` itself, under a longer name,
/// as though the skill offered it — and the list is what the model is *told*.
#[test]
fn an_imported_name_is_not_an_export() {
    assert_eq!(
        exports(
            "import json\nfrom math import hypot\n\ndef pack(rows):\n    return json.dumps(rows)\n"
        ),
        ["pack"]
    );
}

/// **Nothing inside a string is read as a definition.**
///
/// A module docstring that shows its own usage is the most ordinary shape a code skill takes, and
/// the lines inside it are unindented text that reads exactly like a top level.
#[test]
fn a_docstring_is_not_a_top_level() {
    let module = "\
\"\"\"Widen a column.

Usage:

def widen(text, width):
    ...
EXAMPLE = 1
\"\"\"


def widen(text, width):
    return text
";
    assert_eq!(exports(module), ["widen"]);
}

/// **The shapes whose target only a parser could name are left alone**, and a module that binds one
/// still binds it — the guest builds the namespace, and a name gg failed to list is a name the model
/// was not told about rather than a name it cannot reach.
#[test]
fn a_target_that_needs_a_parser_is_not_guessed_at() {
    for source in [
        "rows[0] = 1\n",
        "a, b = 1, 2\n",
        "total += 1\n",
        "if x == 1:\n    pass\n",
        "for row in rows:\n    pass\n",
        "obj.attr = 3\n",
    ] {
        assert!(
            exports(source).is_empty(),
            "`{}` was read as a definition",
            source.trim()
        );
    }
}

/// **A name defined twice is offered once**, because the namespace holds one of it.
#[test]
fn a_redefined_name_is_listed_once() {
    assert_eq!(
        exports("def go():\n    pass\n\n\ndef go():\n    pass\n"),
        ["go"]
    );
}

/// **A module that lexes uncleanly is still read**, because the alternative is telling the model a
/// skill offers nothing when it offers everything.
///
/// The mask exists to keep a `def` inside a docstring out of the list; where the lexer lost its
/// place there is nothing better to do than read the lines, and the cost of being wrong here is a
/// name in a list rather than a deletion.
#[test]
fn an_unlexable_module_is_read_as_lines() {
    assert_eq!(
        exports("broken = 'unterminated\ndef go():\n    pass\n"),
        ["broken", "go"]
    );
}
