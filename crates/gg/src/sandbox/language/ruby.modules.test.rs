//! What a Ruby code module is read to offer, and — as often — what it is deliberately not.

use super::exports;

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
    assert_eq!(exports(module), ["widen", "parse", "empty?"]);
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
        exports("HEADER = \"name,size\"\nTIMEOUT = 30\n\ndef widen(text)\n  text\nend\n"),
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
    assert_eq!(exports(module), ["widen", "visible"]);
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
    assert_eq!(exports(module), ["widen"]);
}

/// **An operator method is not reported**, because `lib.<key>.` cannot reach one.
///
/// `def ==(other)` and `def [](index)` are real definitions and are really bound; they are simply
/// not names a program spells after a dot, so naming them in the reply that binds the module would
/// be describing a call the model cannot make.
#[test]
fn an_operator_method_is_not_a_name_a_program_can_write() {
    assert_eq!(
        exports("def ==(other)\n  true\nend\n\ndef save!(row)\n  row\nend\n"),
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
        exports("x = \"unterminated\n\ndef widen(t)\n  t\nend\n"),
        ["widen"]
    );
}
