//! What a Ruby code module is read to offer, and — as often — what it is deliberately not.

use super::exports;
use crate::sandbox::ModuleExportKind;

/// The names alone — what most of a scan's own assertions are about. What each export carries
/// *beside* its name is asserted in its own test below.
fn names(source: &str) -> Vec<String> {
    exports(source)
        .into_iter()
        .map(|export| export.name)
        .collect()
}

/// **A module's methods are its exports**, in source order, each spelled once.
///
/// `def self.name` counts beside `def name`, because the wrapper's module extends itself and both
/// are reached as `lib.<key>.name`. A `class` is **not** offered — for the same reason a constant is
/// not, below — and a method inside one is not a top-level definition however it is indented.
#[test]
fn a_modules_methods_are_what_it_offers() {
    let module = "\
def widen(text, width)
  text.ljust(width, \".\")
end

def self.parse(line)
  line.split(\",\")
end

def empty?(rows)
  rows.empty?
end

class Row
  def initialize(name)
    @name = name
  end
end
";
    assert_eq!(names(module), ["widen", "parse", "empty?"]);
}

/// **A constant is not offered, and that is a fact about how the module is evaluated.**
///
/// The author's source is a *block*, and a constant assigned inside a block belongs to the block's
/// lexical scope — the top level — rather than to the module the block is evaluated against. So
/// `lib.helpers.HEADER` does not exist however the file is written, and reporting it would send a
/// model at a name that raises. A `class` or a nested `module` is a constant by the same rule, which
/// is why neither is offered either.
#[test]
fn a_constant_is_not_an_export() {
    assert_eq!(
        names("HEADER = \"name,size\"\nTIMEOUT = 30\n\ndef widen(text)\n  text\nend\n"),
        ["widen"]
    );
}

/// **Ruby's own privacy is honoured**, both ways of spelling it.
///
/// A bare `private` makes everything below it private and `public` turns it back on; `private def`
/// makes one method private. Reporting either would tell a model about a call that raises
/// `NoMethodError`, which is a turn.
#[test]
fn a_private_method_is_not_offered() {
    let module = "\
def widen(text)
  pad(text)
end

private def pad(text)
  text
end

private

def secret
  1
end

public

def visible
  2
end
";
    assert_eq!(names(module), ["widen", "visible"]);
}

/// **Nothing inside a heredoc is read as a definition.**
///
/// A code skill that shows its own usage in a heredoc is the most ordinary shape one takes, and the
/// lines inside it are unindented text that reads exactly like a top level.
#[test]
fn a_heredoc_is_not_a_top_level() {
    let module = "\
USAGE = <<~TEXT
  Widen a column.

def widen(text, width)
  ...
end
TEXT

def widen(text, width)
  text
end
";
    assert_eq!(names(module), ["widen"]);
}

/// **An operator method is not reported**, because `lib.<key>.` cannot reach one.
///
/// `def ==(other)` and `def [](index)` are real definitions and are really bound; they are simply
/// not names a program spells after a dot, so naming them in the reply that binds the module would
/// be describing a call the model cannot make.
#[test]
fn an_operator_method_is_not_a_name_a_program_can_write() {
    assert_eq!(
        names("def ==(other)\n  true\nend\n\ndef save!(row)\n  row\nend\n"),
        ["save!"]
    );
}

/// **A module gg could not lex is read as though it were all code.**
///
/// The mask exists to keep a `def` inside a heredoc from being read as a definition; where the lexer
/// lost its place — here, an unterminated string — there is nothing better to do than read the
/// lines, and the cost of being wrong is a name in a list rather than a deletion.
#[test]
fn an_unlexable_module_is_still_read() {
    assert_eq!(
        names("x = \"unterminated\n\ndef widen(t)\n  t\nend\n"),
        ["widen"]
    );
}

/// **An export carries what a documentation view is rendered from.** Every one of them is a method
/// here, because a method is the only thing the wrapper's module ends up offering.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = "# Widen a row.\n\
                  def widen(text, width)\n\
                  \x20 text\n\
                  end\n\
                  \n\
                  def twice(x) = x * 2\n";
    let exports = exports(module);
    assert_eq!(names(module), ["widen", "twice"]);

    // Ruby's body starts on the line below, so the `def` line is already the declaration.
    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[0].declaration, "def widen(text, width)");
    assert_eq!(exports[0].doc.as_deref(), Some("Widen a row."));

    // An endless method's body is the one expression after its `=`, and that is a body too.
    assert_eq!(exports[1].kind, ModuleExportKind::Function);
    assert_eq!(exports[1].declaration, "def twice(x)");
    assert_eq!(exports[1].doc, None);

    assert!(exports.iter().all(|export| export.returns.is_empty()));
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
}

/// **A default parameter value is part of the declaration**, not the body an endless method opens.
///
/// Both are written `name = value`, and only one of them is at bracket depth zero. Quoting
/// `def widen(text, width` would show the model a line Ruby does not parse and drop the very
/// parameter whose spelling it opened the view to read.
#[test]
fn a_default_parameter_value_does_not_end_the_declaration() {
    let module = "\
def widen(text, width = 8)
  text.ljust(width)
end

def clamp(value, low = 0, high = 10) = value.clamp(low, high)
";
    let exports = exports(module);
    assert_eq!(names(module), ["widen", "clamp"]);
    assert_eq!(exports[0].declaration, "def widen(text, width = 8)");
    // The endless method's own `=` is still the cut: it is the one outside the parameter list.
    assert_eq!(
        exports[1].declaration,
        "def clamp(value, low = 0, high = 10)"
    );
}
