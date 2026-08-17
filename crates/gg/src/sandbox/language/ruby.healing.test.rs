//! Tests for **Ruby's [healing dialect](crate::healing::Dialect)** — the answers whose rule is a
//! fact about Ruby rather than about gg's contract.
//!
//! One of them is an answer no other arm gives — a lexer with five string shapes in it — and one is a
//! "no" this arm shares with [Python](super::super::python::healing) for a reason restated in Ruby.
//! The "no" gets attention here because a *correct* refusal looks exactly like one that was never
//! implemented: a `#` line is never deleted as prose, and that has to be shown to be a decision.
//!
//! Every case that asserts a repair drives the whole of [`heal`](crate::healing::heal) rather than
//! calling a predicate directly, because a predicate's answer only matters through the deletion it
//! authorises — and a test that asserted the answer alone would keep passing while the deletion it
//! licenses stopped happening.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`RubyDialect::fixtures`].
///
/// Each is a shape whose repair — or whose deliberate *refusal* to repair — is this dialect's rather
/// than the skeleton's: a fenced program with prose around it, both of the `Thread` shapes a model
/// wraps a program in and which nothing here touches, a program whose `require`s must survive, a
/// heredoc carrying text that reads exactly like a top level, an interpolation carrying the outer
/// quote, a `%w` list, a doubled program that must be left doubled, a comment-only reply, and a
/// reply that is nothing but prose.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```ruby\nrequire \"gg\"\n\nrows = GG::Files.list_dir(\"src\")\nGG::Views.open_text(\"rows\", rows.inspect)\n```\n\nThat should list the directory.",
    "require \"gg\"\n\nThread.new do\n  rows = GG::Files.list_dir(\"src\")\n  GG::Views.open_text(\"rows\", rows.inspect)\nend.join",
    "require \"gg\"\n\nworker = Thread.new do\n  GG::Views.open_text(\"note\", \"done\")\nend\nworker.join",
    "require \"gg\"\nrequire \"json\"\nrequire \"set\"\n\npayload = JSON.generate({ \"ok\" => true })\nGG::Files.write_file(\"out.json\", payload)",
    "USAGE = <<~TEXT\n  Example:\n\n  Thread.new do\n    total = 1\n  end.join\nTEXT\ntotal = 2\n",
    "require \"gg\"\n\nname = \"world\"\nGG::Views.open_text(\"greeting\", \"hello #{name.split(\"o\").first}\")",
    "require \"gg\"\n\nwanted = %w[cargo nextest]\nGG::Views.open_text(\"wanted\", wanted.join(\", \"))",
    "total = 1\nGG::Views.open_text(\"total\", total.to_s)\n\ntotal = 1\nGG::Views.open_text(\"total\", total.to_s)",
    "# I have already written MANIFEST.md.\n# Nothing left to do.",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Ruby).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn ruby() -> &'static dyn Dialect {
    &RUBY_DIALECT
}

// ---------------------------------------------------------------------------------------------
// The strategy that asks this dialect nothing
// ---------------------------------------------------------------------------------------------

/// **`drop-doubled-response` fires on this arm**, as it does on every other.
///
/// It is the transport-level doubling — a completion concatenated with a byte-identical copy of
/// itself — and it is the one strategy that asks a dialect nothing at all, so what this case shows
/// is that Ruby's registration reaches it. Armed explicitly, because it is the one strategy gg does
/// not arm by default.
#[test]
fn a_doubled_response_is_still_halved() {
    let program = "rows = GG::Files.list_dir(\"src\")\nGG::Views.open_text(\"rows\", rows.inspect)";
    let mut config = HealingConfig::default();
    config.set(HealingStrategy::DropDoubledResponse, true);
    let result = heal(
        &format!("{program}{program}"),
        &config,
        crate::sandbox::language(GgProgramLanguage::Ruby).healing(),
    );
    assert_eq!(result.program, program);
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::DropDoubledResponse]
    );
}

// ---------------------------------------------------------------------------------------------
// The lexical mask
// ---------------------------------------------------------------------------------------------

/// **A heredoc is string text, newlines and all** — so a usage example carrying what reads like a
/// whole top level is read as the text it is rather than as code.
#[test]
fn a_heredoc_is_not_code() {
    let reply = "USAGE = <<~TEXT\nThread.new do\n  total = 1\nend.join\nTEXT\ntotal = 1";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.strategies().is_empty());

    // The whole body is string text, and the terminator line closes it.
    let mask = ruby().code_mask(reply).expect("the heredoc lexes");
    let body = reply.find("Thread.new").expect("the body is in the reply");
    assert!(!mask.is_code(body));
    assert!(mask.is_code(reply.rfind("total = 1").expect("the program is code")));
}

/// **A `<<` that is the shift operator is not read as a heredoc.**
///
/// The ambiguity is real Ruby and it is what the ALL-CAPS rule buys: `rows << item` is an append,
/// and reading it as a heredoc would swallow the rest of the program as string text.
#[test]
fn the_shift_operator_is_not_a_heredoc() {
    let reply = "rows = []\nrows << \"one\"\nGG::Views.open_text(\"rows\", rows.inspect)";
    let mask = ruby().code_mask(reply).expect("the shift lexes");
    assert!(mask.is_code(reply.rfind("GG::Views").expect("the last call is code")));
    assert_eq!(healed(reply).program, reply);
}

/// **An interpolation is string text, delimited by brace counting.**
///
/// Ruby allows an interpolation to re-use the outer quote, so a scan that looked for the closing
/// quote would lose its place on exactly the input hardest to notice.
#[test]
fn an_interpolation_carrying_the_outer_quote_still_lexes() {
    let source =
        "GG::Views.open_text(\"greeting\", \"hello #{rows[\"name\"]}, #{rows.size} rows\")";
    let mask = ruby().code_mask(source).expect("the interpolation lexes");
    assert!(mask.is_code(source.find("GG::Views").expect("the call is code")));
    assert!(!mask.is_code(source.find("hello").expect("the literal is text")));
    // The tail after the interpolation is still inside the same string.
    assert!(!mask.is_code(source.find(" rows\")").expect("still inside")));
}

/// **The `%w[…]` family is string text**, nesting included.
#[test]
fn a_percent_literal_is_not_code() {
    let source = "wanted = %w[cargo nextest]\ntotal = 7 % 3\n";
    let mask = ruby().code_mask(source).expect("the literal lexes");
    assert!(!mask.is_code(source.find("cargo").expect("inside the list")));
    // A modulo is arithmetic, not a literal, so what follows it is still code.
    assert!(mask.is_code(source.rfind('3').expect("the operand is code")));
}

/// **An `=begin` block comment is comment text**, and only at column zero.
#[test]
fn a_block_comment_is_not_code() {
    let source = "=begin\nThread.new do\n  total = 1\nend.join\n=end\ntotal = 1\n";
    let mask = ruby().code_mask(source).expect("the block comment lexes");
    assert!(!mask.is_code(source.find("Thread").expect("inside the comment")));
    assert!(mask.is_code(source.rfind("total").expect("after the comment")));
    assert_eq!(healed(source).program, source.trim());
}

/// **A string still open at the end of input means the scan lost its place**, so the mask is `None`
/// and every caller that needs one declines rather than acting on a reading already known to be
/// wrong.
///
/// A Ruby string may span newlines, unlike Python's, so what ends the scan uncleanly is the end of
/// the source rather than the end of a line — and a regular-expression literal carrying an
/// apostrophe is the ordinary way to get there, because `/…/` is deliberately not read.
#[test]
fn an_unterminated_string_declines_the_mask() {
    assert!(
        ruby()
            .code_mask("total = \"unterminated\nrows = []\n")
            .is_none()
    );
    assert!(ruby().code_mask("match = line =~ /it's here/\n").is_none());
}

// ---------------------------------------------------------------------------------------------
// The line predicates
// ---------------------------------------------------------------------------------------------

/// **A fenced program is unwrapped**, whichever of this dialect's tags it carries — and untagged.
#[test]
fn a_fenced_program_is_unwrapped() {
    for tag in ["ruby", "rb", ""] {
        let result = healed(&format!(
            "Here is the program.\n\n```{tag}\ntotal = 1\nGG::Views.open_text(\"total\", total.to_s)\n```"
        ));
        assert_eq!(
            result.program, "total = 1\nGG::Views.open_text(\"total\", total.to_s)",
            "a block tagged `{tag}` was not unwrapped"
        );
    }
}

/// **This dialect's tags are its own**, and no other arm's are among them.
#[test]
fn the_fence_tags_are_rubys() {
    let tags = ruby().program_fence_tags();
    assert!(tags.contains(&"ruby") && tags.contains(&"rb"));
    assert!(!tags.contains(&"ts") && !tags.contains(&"py"));
    // A transcript is not a program: every line of one carries a prompt and the interpreter's own
    // answers are interleaved with it.
    assert!(!tags.contains(&"irb") && !tags.contains(&"pry"));
}

/// **A `#` line is never deleted as prose**, because a Ruby comment and a Markdown heading are the
/// same byte and nothing lexical tells them apart.
#[test]
fn a_hash_line_is_never_prose() {
    for line in ["# Plan", "## What I did", "# read the manifest first"] {
        assert!(!ruby().is_prose_line(line), "`{line}` was read as prose");
    }
}

/// **A block opener is code, and a sentence that happens to end in `do` is not deleted either.**
///
/// The trailing `do` is the Ruby shape the trailing `:` is in Python — it opens the block on the
/// line that ends with it. `Here is what I will do` satisfies it too, which costs a fence that could
/// have been unwrapped and is the safe direction.
#[test]
fn a_trailing_do_opens_a_block() {
    for line in [
        "rows.each do |row|",
        "loop do",
        "File.open(path) do",
        "5.times do",
    ] {
        assert!(
            ruby().looks_like_code(line),
            "`{line}` was not read as code"
        );
        assert!(!ruby().is_prose_line(line), "`{line}` was read as prose");
    }
}

/// **A keyword is matched case-sensitively**, which is the difference between the `if` that opens a
/// statement and the `If` that opens a sentence.
#[test]
fn a_capitalised_keyword_is_prose() {
    assert!(ruby().is_prose_line("If the manifest is missing I will write one."));
    assert!(!ruby().is_prose_line("if manifest.nil?"));
    assert!(!ruby().is_prose_line("return total"));
    // The two pattern-matching openers that would otherwise read as two words of English — and
    // whose deletion would be a deletion of the model's own code.
    assert!(!ruby().is_prose_line("in Integer => n"));
    assert!(!ruby().is_prose_line("when TextFile"));
}

/// **The shapes only Ruby has are read as code**, one clause each.
#[test]
fn each_code_clause_reads_its_own_shape() {
    for line in [
        "require \"json\"",                   // a statement keyword
        "end",                                // the closer every block has
        "@count = 0",                         // an instance variable
        "rows = GG::Files.list_dir(\"src\")", // an assignment
        "Config::LIMIT = 3",                  // a qualified constant
        "total += 1",                         // an augmented assignment
        "GG::Views.open_text(\"a\", \"b\")",  // a call
        "ledger.add(3)",                      // a call on the program's own object
        "entries = [",                        // left open
        "  \"one\",",                         // left open
        "rows.each { |row|",                  // left open on a block parameter
        "attr_reader :name",                  // a declaration macro
    ] {
        assert!(
            ruby().looks_like_code(line),
            "`{line}` was not read as code"
        );
    }
}

/// **Prose is deleted from around a bare program**, which is the repair both predicates exist for.
#[test]
fn prose_around_a_bare_program_is_deleted() {
    let result = healed(
        "I will list the source directory and show myself the result.\n\
         rows = GG::Files.list_dir(\"src\")\n\
         GG::Views.open_text(\"rows\", rows.inspect)\n\
         That should be everything.",
    );
    assert_eq!(
        result.program,
        "rows = GG::Files.list_dir(\"src\")\nGG::Views.open_text(\"rows\", rows.inspect)"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::StripProse]);
}
