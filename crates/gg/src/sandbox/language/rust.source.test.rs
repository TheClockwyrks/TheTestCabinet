//! What gg writes around a model's Rust: that it costs exactly one line, and that it refuses exactly
//! one shape.

use super::*;

/// **The wrapper costs one line, and [`LINE_OFFSET`] says so.**
///
/// Everything that makes a diagnostic land where the model wrote it rests on this one number, and
/// the number is a constant a later edit to [`prologue`] could quietly falsify — a second newline in
/// the prologue would move every diagnostic on the arm down a line while every test that checks a
/// *rendered* diagnostic went on passing, because both halves would have moved together.
#[test]
fn the_prologue_is_one_line_and_the_offset_says_so() {
    assert_eq!(
        prologue().lines().count(),
        LINE_OFFSET,
        "the prologue is no longer {LINE_OFFSET} line(s), so every diagnostic on this arm is now \
         reported against the wrong line"
    );
    assert!(
        !prologue().contains('\n'),
        "the prologue must be one line; the newline that separates it from the model's text is \
         added by `wrap`"
    );
}

/// **The model's text is copied verbatim, at a known offset.**
///
/// Not merely "the program appears somewhere in the file": each of the model's lines must be exactly
/// one line further down, and no column may move at all, because a column is reported without any
/// correction.
#[test]
fn every_line_of_the_model_moves_down_by_exactly_the_offset() {
    let program = "let alpha = 1;\nlet beta = alpha + 1;\n\nlet gamma = beta * 2;\n";
    let wrapped = wrap(program, &[]).expect("an ordinary program is wrapped");
    let lines: Vec<&str> = wrapped.lines().collect();
    for (index, original) in program.lines().enumerate() {
        assert_eq!(
            lines[index + LINE_OFFSET],
            original,
            "the model's line {} did not land at file line {}",
            index + 1,
            index + 1 + LINE_OFFSET
        );
    }
}

/// **A trailing expression does not run into gg's epilogue.**
///
/// A program whose last line is `total` rather than `total;` is ordinary Rust, and without the
/// separator the epilogue opens with it would be spliced onto the `Ok(())` and produce a syntax
/// error in gg's own wrapper reported against the model's last line — the worst kind of diagnostic
/// there is.
#[test]
fn a_program_ending_in_an_expression_is_separated_from_the_epilogue() {
    let wrapped = wrap("let total = 1 + 1;\ntotal", &[]).expect("a trailing expression is wrapped");
    assert!(
        wrapped.contains("total\n;\n"),
        "the separator is missing: {wrapped}"
    );
}

/// **`fn main` is refused, and nothing else that merely looks like it is.**
#[test]
fn a_program_that_defines_main_is_refused_and_its_neighbours_are_not() {
    for refused in [
        "fn main() {}",
        "  fn main() {}",
        "pub fn main() {}",
        "async fn main() {}",
        "fn main<T>() {}",
        "let x = 1;\nfn main() { }",
    ] {
        let error = wrap(refused, &[]).expect_err("a program that defines main is refused");
        assert!(
            matches!(error, PrepareError::Unsupported(_)),
            "{refused:?} was refused as {error:?} rather than as unsupported"
        );
    }

    for allowed in [
        "fn maintain() {}",
        "let main = 1;",
        "// fn main() {}",
        "let note = \"fn main() {}\";",
        "fn mainline(value: u32) -> u32 { value }",
    ] {
        wrap(allowed, &[]).unwrap_or_else(|error| panic!("{allowed:?} was refused: {error}"));
    }
}

/// **The refusal names the line and says what to write instead.**
///
/// A refusal that only said "no" would cost the model a turn and teach it nothing; this one is the
/// only place a model is told the shape of a program on this arm outside its system prompt.
#[test]
fn the_refusal_locates_itself_and_says_what_to_do() {
    let error = wrap("let alpha = 1;\n\nfn main() {\n    alpha;\n}\n", &[])
        .expect_err("a program that defines main is refused");
    let PrepareError::Unsupported(reason) = error else {
        panic!("expected an unsupported refusal");
    };
    assert!(reason.starts_with("line 3:"), "{reason}");
    assert!(reason.contains("sequence of statements"), "{reason}");
    assert!(reason.contains("`use`"), "{reason}");
}

/// **The wrapper names the crate and the file exactly once each**, out of the constants everything
/// else here reads — so the name the panic hook compares against and the name `rustc` is given are
/// one name.
#[test]
fn the_wrapper_is_built_from_the_constants_the_compile_uses() {
    let prologue = prologue();
    assert!(prologue.contains(&format!("::{SDK_CRATE}::program::begin({PROGRAM_FILE:?}")));
    assert!(prologue.contains(&format!("::{SDK_CRATE}::bindings::export!")));
    assert!(prologue.contains(&format!("{LINE_OFFSET});")));
}
