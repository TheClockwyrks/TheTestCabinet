//! **The authorship gate's own tests** — the eleven-arm run, and the proof that the classification
//! behind it has teeth.
//!
//! The gate is one assertion over every registered arm. Everything else here is about the
//! classification itself: a gate whose verdict nothing has ever exercised is a gate nobody knows
//! reports the truth, and this one decides whether an arm is recorded as a defect.

use test_cabinet_core::gg::GgProgramLanguage;

use super::{Did, Half, Loaded, UNCONVERTED, audit, classify, maps_back};

/// **Every registered arm compiles the bytes it was handed, or says in [`UNCONVERTED`] what it does
/// instead.**
///
/// The gate. It drives each arm's module step and each arm's program step — the second one twice,
/// once with a module in scope — through that arm's real preparation, its real compiler where it has
/// one, and reports every arm whose verdict and row disagree, in either direction.
#[test]
fn every_registered_arm_compiles_the_bytes_it_was_handed_or_records_what_it_does_instead() {
    let audit = audit();
    assert!(
        audit.failures.is_empty(),
        "{} of the {} preparation steps fail the authorship gate:\n\n{}",
        audit.failures.len(),
        audit.drives,
        audit
            .failures
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n\n---\n\n")
    );
}

/// **A preparation that hands back what it was given is `Kept`** — including one that adds nothing
/// but the trailing newline a file ends with.
///
/// The newline is deliberate rather than incidental: an arm writes a model's reply to a file and a
/// file ends in a newline, and calling that a wrapper would put every arm in the table and make the
/// table meaningless.
#[test]
fn a_preparation_that_hands_its_source_back_kept_it() {
    let source = "docs.search(modules=[\"gg.files\"], limit=200)\n";
    for produced in [
        vec![source.to_string()],
        vec![source.trim_end().to_string()],
        vec![format!("{source}\n")],
        // Something unrelated beside it changes nothing: an SDK file in the same workspace is not a
        // version of the model's program.
        vec![
            source.to_string(),
            "public interface Files {}\n".to_string(),
        ],
    ] {
        let verdict = classify(source, &produced).expect("the source is there to be found");
        assert_eq!(verdict.did, Did::Kept, "produced: {produced:?}");
    }
}

/// **A preparation that puts the source inside something larger `Wrapped` it**, whatever the
/// something is.
#[test]
fn a_preparation_that_completes_the_source_wrapped_it() {
    let source = "docs.search(modules=[\"gg.files\"], limit=200)\n";
    for produced in [
        format!("fn main() {{\n{source}}}\n"),
        format!("import gg\n{source}"),
        format!("{source};\nOk(())\n"),
    ] {
        let verdict =
            classify(source, std::slice::from_ref(&produced)).expect("the source is inside it");
        assert_eq!(verdict.did, Did::Wrapped, "produced: {produced:?}");
    }
}

/// **A preparation that moved a byte of the source `Rewrote` it** — an indent, a re-print, a hoisted
/// line.
///
/// Each of these keeps every statement the source had. That is the point: the model's program still
/// runs, and the text a diagnostic is reported against is no longer the text the model wrote.
#[test]
fn a_preparation_that_moved_a_byte_rewrote_the_source() {
    let source = "const modules = [\"gg.files\"];\nfor (const path of modules) search(path);\n";
    for produced in [
        // Indented into a body.
        "function body() {\n    const modules = [\"gg.files\"];\n    for (const path of modules) \
         search(path);\n}\n",
        // A line of gg's own put between two of the model's.
        "const modules = [\"gg.files\"];\nconst gg = globalThis.gg;\nfor (const path of modules) \
         search(path);\n",
        // Re-printed by a code generator, which broke the loop over three lines.
        "const modules = [\"gg.files\"];\nfor (const path of modules) {\n\tsearch(path);\n}\n",
    ] {
        let verdict = classify(source, &[produced.to_string()]).expect("it is still that program");
        assert_eq!(verdict.did, Did::Rewritten, "produced: {produced:?}");
    }
}

/// **The verdict is the least faithful thing the preparation produced**, so an arm that hands its
/// compiler the model's own file and its guest a re-print of it is reported on the re-print.
///
/// This is the shape a most-faithful rule would miss, and it is a real one: a type strip checks the
/// file the model wrote and evaluates a printed copy of it.
#[test]
fn one_faithful_copy_does_not_excuse_a_rewrite_beside_it() {
    let source =
        "const modules = [\n  \"gg.files\",\n];\nfor (const path of modules) search(path);\n";
    let verdict = classify(
        source,
        &[
            source.to_string(),
            "const modules = [\"gg.files\"];\nfor (const path of modules) search(path);\n"
                .to_string(),
        ],
    )
    .expect("both are versions of that program");
    assert_eq!(verdict.did, Did::Rewritten);
}

/// **A preparation that produced nothing resembling its input is classified as nothing at all**, so
/// the gate reports it as a preparation whose program vanished rather than as a rewrite.
///
/// The line threshold is what makes this possible: an SDK header and a compiler's own bundle share
/// braces and keywords with every program ever written, and a classification that counted those
/// would call each of them a version of the model's program.
#[test]
fn a_text_that_shares_no_line_of_the_source_is_not_a_version_of_it() {
    let source = "docs.search(modules=[\"gg.files\"], limit=200)\n";
    assert!(
        classify(
            source,
            &[
                "}\n".to_string(),
                "  }\n}\n".to_string(),
                "public interface Docs {\n  void search(String query);\n}\n".to_string(),
            ]
        )
        .is_none(),
        "an unrelated file was read as a version of the model's program"
    );
}

/// **A file the module in scope explains better is not read as the program**, and a file carrying the
/// program **whole** is never given away however much of the module it also carries.
///
/// The [loaded drive](super::Scope::Loaded) hands an arm two sources, and both come out of gg's own
/// generators — so on the arms that take the seam's default module the two share a header, an import
/// preamble and a loop, and the module's own file clears [`is_version_of`](super::is_version_of)
/// against a program it is not a version of. That is measured, not hypothetical: PureScript's module
/// file was read as its opening program the first time this drive ran.
///
/// The second half is the one that matters more, because it is the failure this drive exists to
/// catch: an arm that answers a module in scope by writing the module's declarations in front of the
/// reply produces a text that carries *both* whole, and an attribution that handed it to the module
/// would report the injection as a program kept.
#[test]
fn a_file_the_module_explains_better_is_not_read_as_the_program() {
    let program = "module Main where\n\nimport Data.Foldable (for_)\nimport Effect (Effect)\n\n                   modules :: Array String\nmodules =\n  [ \"gg.docs\" ]\n\n                   main :: Effect Unit\nmain = for_ modules openDocsView\n";
    let module = "module Main where\n\nimport Data.Foldable (for_)\nimport Effect (Effect)\n\n                  marker :: String\nmarker = \"gg-authorship-marker\"\n";
    let loaded = Loaded {
        texts: vec![module.to_string(), module.replace("Main", "Lib.Module")],
        bound: Vec::new(),
    };

    assert!(
        loaded.owns(program, &module.replace("Main", "Lib.Module")),
        "the module's own file, filed under the name a program imports it by, is the module's"
    );
    assert!(
        !loaded.owns(program, program),
        "the program's own file is the program's, however much of its preamble the module repeats"
    );
    assert!(
        !loaded.owns(program, &format!("{module}\n{program}")),
        "a text carrying the program whole is the program's, whatever else was written in front of it"
    );
}

/// **No two rows describe the same cell**, so a row cannot be satisfied by a duplicate of itself and
/// a deletion cannot leave a copy behind.
#[test]
fn no_two_rows_record_the_same_arm_and_half() {
    let mut seen: Vec<(GgProgramLanguage, Half)> = Vec::new();
    for row in UNCONVERTED {
        let cell = (row.arm, row.half);
        assert!(
            !seen.contains(&cell),
            "{:?} {} has two rows in `UNCONVERTED`",
            row.arm,
            row.half.label()
        );
        seen.push(cell);
    }
}

/// **Every row records a cell the gate actually drives**, and never
/// [`Kept`](Did::Kept) — a row saying an arm keeps its bytes is a row that can only ever fail.
#[test]
fn every_row_records_a_cell_the_gate_drives() {
    for row in UNCONVERTED {
        assert!(
            GgProgramLanguage::ALL.contains(&row.arm),
            "`UNCONVERTED` holds a row for {:?}, which is not a registered arm",
            row.arm
        );
        assert_ne!(
            row.did,
            Did::Kept,
            "{:?} {}'s row records that it keeps its bytes, which is what having no row means",
            row.arm,
            row.half.label()
        );
        assert!(
            !row.adds.is_empty() && !row.instead.is_empty(),
            "{:?} {}'s row says nothing about what it does instead",
            row.arm,
            row.half.label()
        );
    }
}

/// **A rewrite is excused by a source map only when the map really names the bytes it was handed.**
///
/// [`Did::Mapped`] is the one verdict that needs no row, so it is the one an arm could claim its way
/// out of the table with. [`maps_back`] is what stops that, and each of these is a map that must not
/// buy it: none at all, one whose embedded source is some other text, and one with no mappings in it.
///
/// The positive case is the arm itself — `typescript.compile.test.rs` asserts that `tsc`'s emission
/// carries the reply byte for byte — so what is driven here is every way the check has to say no.
#[test]
fn only_a_map_that_names_the_handed_bytes_excuses_a_rewrite() {
    let handed = "const answer = 1;\nconsole.log(answer);\n";
    let rewritten = "const answer = 1;\nconsole.log(answer);\n";

    /// The emitted text with an inline map of `source_content` and `mappings`.
    fn emitted(text: &str, source_content: serde_json::Value, mappings: &str) -> String {
        use base64::Engine as _;
        let map = serde_json::json!({
            "version": 3,
            "file": "program.js",
            "sources": ["program.ts"],
            "sourcesContent": [source_content],
            "names": [],
            "mappings": mappings,
        });
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(serde_json::to_string(&map).expect("the map serialises"));
        format!("{text}//# sourceMappingURL=data:application/json;base64,{encoded}")
    }

    assert!(
        !maps_back(handed, rewritten),
        "a text with no map at all names nothing"
    );
    assert!(
        !maps_back(
            handed,
            &emitted(
                rewritten,
                serde_json::json!("something else entirely\n"),
                "AAAA"
            )
        ),
        "a map of some other text is a map of some other program"
    );
    assert!(
        !maps_back(handed, &emitted(rewritten, serde_json::json!(handed), "")),
        "a map with no mappings resolves nothing, so it locates nothing"
    );
    assert!(
        !maps_back(handed, &emitted(rewritten, serde_json::Value::Null, "AAAA")),
        "a map that does not carry its source cannot be held to it"
    );
    assert!(
        maps_back(
            handed,
            &emitted(rewritten, serde_json::json!(handed), "AAAA")
        ),
        "and a map that names the handed bytes and resolves into them does excuse the rewrite"
    );
}
