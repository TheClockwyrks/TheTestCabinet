//! What the two caps promise the arms that call them, and what they promise the model reading the
//! result.
//!
//! Every case here is a string in and a string out, so the whole file runs in microseconds and none
//! of it needs a compiler. That is deliberate: the arms' own tests assert what their compilers say,
//! and this file asserts what happens to it afterwards — a bug in the second is a bug in every arm
//! at once, and it should not need a toolchain installed to catch.

use super::*;

/// Three distinct renderings, in the order a compiler would have found them.
fn three() -> Vec<String> {
    vec!["one".to_string(), "two".to_string(), "three".to_string()]
}

#[test]
fn identical_renderings_are_folded_and_the_first_of_them_keeps_its_place() {
    // The measured case: one unsupported call reported once per call site, byte-identical every
    // time. A model that reads it four times has learned what it learned from reading it once and
    // paid four times for it.
    let rendered = capped(
        vec![
            "unresolved reference 'nope'".to_string(),
            "keep me".to_string(),
            "unresolved reference 'nope'".to_string(),
            "unresolved reference 'nope'".to_string(),
        ],
        8,
        "\n\n",
    );
    assert_eq!(rendered, "unresolved reference 'nope'\n\nkeep me");
    // Folded to the FIRST occurrence, not the last: the compiler's order is the file's order, and
    // the model reads the file top to bottom.
    assert!(rendered.starts_with("unresolved"), "{rendered}");
}

#[test]
fn folding_is_byte_identical_only_so_the_same_mistake_at_two_places_is_two_things_to_fix() {
    // The same message at two lines is two edits. Folding on the message alone would tell a model it
    // had one call site to fix when it has two, and it would find that out a turn later.
    let rendered = capped(
        vec![
            "program.kts:7:19: unresolved reference 'nope'".to_string(),
            "program.kts:9:4: unresolved reference 'nope'".to_string(),
        ],
        8,
        "\n\n",
    );
    assert_eq!(
        rendered,
        "program.kts:7:19: unresolved reference 'nope'\n\nprogram.kts:9:4: unresolved reference 'nope'"
    );
}

#[test]
fn a_list_that_exactly_fills_the_cap_is_not_counted_at_all() {
    // The boundary in both directions, because an off-by-one here is a model told there is "1 more"
    // of something it has already been shown — which sends it looking for a diagnostic that does not
    // exist.
    let rendered = capped(three(), 3, "\n\n");
    assert_eq!(rendered, "one\n\ntwo\n\nthree");
    assert!(!rendered.contains("more like these"), "{rendered}");
}

#[test]
fn one_over_the_cap_drops_exactly_one_and_says_so() {
    let rendered = capped(three(), 2, "\n\n");
    assert_eq!(rendered, "one\n\ntwo\n\n… and 1 more like these.");
}

#[test]
fn the_count_is_of_what_survived_folding_rather_than_of_what_arrived() {
    // Forty entries, two of them distinct. A count of what arrived would say "38 more" about a list
    // with nothing left in it, which is worse than saying nothing: it is gg reporting a number the
    // model cannot reconcile with what it was shown.
    let mut many: Vec<String> = vec!["distinct".to_string()];
    many.extend((0..39).map(|_| "repeated".to_string()));
    assert_eq!(
        capped(many, 1, " | "),
        "distinct | … and 1 more like these."
    );
}

#[test]
fn the_dropped_count_wording_is_the_one_the_kotlin_arm_has_always_printed() {
    // Asserted as a literal on purpose. This string is in a model's context window and in that
    // arm's own tests, and it is the one sentence in this module a reader has to be able to trust
    // without reading the module.
    let rendered = capped(
        (0..30).map(|line| format!("line {line}")).collect(),
        8,
        "\n\n",
    );
    assert!(
        rendered.ends_with("\n\n… and 22 more like these."),
        "{rendered}"
    );
}

#[test]
fn an_empty_list_is_an_empty_string_and_not_a_count_of_nothing() {
    assert_eq!(capped(Vec::new(), 8, "\n\n"), "");
    assert_eq!(capped(Vec::new(), 0, "\n\n"), "");
}

#[test]
fn a_cap_of_zero_is_the_count_alone_with_no_separator_in_front_of_it() {
    // "Tell it only how many" is a legal request, and the answer must not open with the separator
    // an empty kept-list would otherwise be joined to.
    assert_eq!(capped(three(), 0, "\n\n"), "… and 3 more like these.");
}

#[test]
fn nothing_is_trimmed_off_an_entry_or_out_from_between_them() {
    // An excerpt and a caret only line up if nothing touched them, so leading and trailing
    // whitespace survives — including on the last entry, where a trim would be invisible until an
    // arm rendered a caret there.
    let rendered = capped(
        vec!["  indented\n     ^".to_string(), "trailing   ".to_string()],
        8,
        "\n\n",
    );
    assert_eq!(rendered, "  indented\n     ^\n\ntrailing   ");
}

/// The shape a text-reporting compiler writes: a located header, then the excerpt and caret that
/// belong to it.
fn group(line: usize) -> String {
    format!("main.swift:{line}:9: error: cannot find 'nope' in scope\n    nope()\n    ^~~~")
}

/// What [`capped_lines`] is handed on the text arms: an `error:` line opens, everything else does
/// not.
fn opens_on_error(line: &str) -> bool {
    line.contains(": error: ")
}

#[test]
fn a_group_is_kept_whole_with_its_excerpt_and_its_caret() {
    let text = format!("{}\n{}\n{}", group(7), group(9), group(11));
    let rendered = capped_lines(&text, opens_on_error, 2);
    assert_eq!(
        rendered,
        format!("{}\n{}\n… and 1 more like these.", group(7), group(9))
    );
    // The caret survived the cut with the header it points under. A cap that kept headers only would
    // be cheaper and would have told the model less than the compiler did.
    assert!(rendered.contains("    ^~~~"), "{rendered}");
}

#[test]
fn a_group_count_that_exactly_fills_the_cap_leaves_the_text_untouched() {
    let text = format!("{}\n{}", group(7), group(9));
    assert_eq!(capped_lines(&text, opens_on_error, 2), text);
    assert_eq!(capped_lines(&text, opens_on_error, 9), text);
}

#[test]
fn everything_before_the_first_group_is_a_preamble_and_survives() {
    // On the text arms this is where a driver's own trouble lands — printed before there was a
    // diagnostic to attach it to. Dropping it leaves a model reading about its program when the
    // sentence was about the machine.
    let text = format!(
        "warning: Unable to locate libSwiftScan\nremark: using toolchain at /usr\n{}\n{}",
        group(7),
        group(9)
    );
    let rendered = capped_lines(&text, opens_on_error, 1);
    assert_eq!(
        rendered,
        format!(
            "warning: Unable to locate libSwiftScan\nremark: using toolchain at /usr\n{}\n… and 1 more like these.",
            group(7)
        )
    );
}

#[test]
fn a_preamble_survives_a_cap_of_zero_and_every_group_is_counted() {
    let text = format!(
        "could not read the module cache\n{}\n{}",
        group(7),
        group(9)
    );
    assert_eq!(
        capped_lines(&text, opens_on_error, 0),
        "could not read the module cache\n… and 2 more like these."
    );
}

#[test]
fn a_cap_of_zero_with_no_preamble_is_the_count_alone() {
    let text = format!("{}\n{}", group(7), group(9));
    assert_eq!(
        capped_lines(&text, opens_on_error, 0),
        "… and 2 more like these."
    );
}

#[test]
fn text_with_no_opening_line_at_all_is_returned_exactly_as_it_arrived() {
    // A compiler that said something `opens` does not recognise has said one thing. Cutting it where
    // there is no evidence of a group would be gg discarding a diagnostic it did not understand —
    // and on the text arms, a driver failure is precisely that shape.
    let text = "ld: symbol(s) not found for architecture wasm32\n  referenced from: main.o";
    assert_eq!(capped_lines(text, opens_on_error, 0), text);
    assert_eq!(capped_lines(text, opens_on_error, 1), text);
    assert_eq!(capped_lines("", opens_on_error, 0), "");
}

#[test]
fn a_group_whose_own_text_contains_the_separator_is_still_one_group() {
    // The item cap joins with a separator; this one does not, and this is the case that shows why
    // the two shapes cannot be one function. A Swift excerpt routinely contains a blank line, which
    // is the item arms' separator — split on it and the caret becomes a diagnostic of its own, and
    // the cap starts counting pictures instead of problems.
    let text = format!(
        "main.swift:7:9: error: cannot find 'nope' in scope\n\n    nope()\n\n    ^~~~\n{}\n{}",
        group(9),
        group(11)
    );
    let rendered = capped_lines(&text, opens_on_error, 1);
    assert_eq!(
        rendered,
        "main.swift:7:9: error: cannot find 'nope' in scope\n\n    nope()\n\n    ^~~~\n… and 2 more like these."
    );
}

#[test]
fn the_count_line_does_not_add_a_blank_line_to_text_that_already_ended_at_one() {
    // The kept group ends on the blank line that separated it from the dropped one. Starting the
    // count after that boundary rather than after another one keeps the result the shape the
    // compiler was writing.
    let text = "a: error: first\n  excerpt\n\na: error: second\n  excerpt";
    assert_eq!(
        capped_lines(text, opens_on_error, 1),
        "a: error: first\n  excerpt\n… and 1 more like these."
    );
}

#[test]
fn interior_lines_keep_their_indentation_and_their_blank_lines() {
    let text = "a: error: first\n\n      deeply    indented   \n\n\n  ^\na: error: second";
    let rendered = capped_lines(text, opens_on_error, 1);
    assert!(
        rendered.starts_with("a: error: first\n\n      deeply    indented   \n\n\n  ^\n"),
        "{rendered}"
    );
}

#[test]
fn the_two_shapes_print_the_same_sentence_about_what_they_dropped() {
    // One wording, so a model that works in two languages is not learning two conventions for the
    // same fact — and so a reader grepping for it finds every place it can come from.
    let items = capped(three(), 1, "\n\n");
    let lines = capped_lines(&format!("{}\n{}", group(7), group(9)), opens_on_error, 1);
    assert!(items.ends_with("… and 2 more like these."), "{items}");
    assert!(lines.ends_with("… and 1 more like these."), "{lines}");
}
