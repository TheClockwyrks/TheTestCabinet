//! Tests for **the Ruby arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a `node` and a 20 MB
//! component, and lives next door in [`ruby.substrate.test.rs`](super::substrate) and
//! [`ruby.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::{FileWindow, ParameterKind};

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn ruby() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Ruby)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `opal` rather than `node`: a model reading the name is being told whose rules it is held to, and
/// `node` is merely the process gg starts the compiler in. Naming one is also what has the compile
/// timed on every turn, which is the number a study compares this arm against
/// [TypeScript](super::typescript) on.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(ruby().checker(), Some("opal"));
    assert!(ruby().prepare_compiles());
}

/// **The prompt states the Ruby level the committed compiler really reports.**
///
/// The one fact in this arm's prompt that is a *version* and therefore rots: a model told it is
/// writing Ruby 3.2 writes `case … in` and does not write `it` as a block parameter, and an Opal
/// bump that moved the level would leave that sentence quietly wrong. The number is prose — no
/// catalogue reflects it — so this is what holds it to `checkers/ruby.compiler.json`.
#[test]
fn the_prompt_states_the_ruby_level_the_compiler_reports() {
    let level = compile::ruby_version();
    let major_minor = level
        .rsplit_once('.')
        .map_or(level, |(head, _patch)| head)
        .to_string();
    let template = ruby().prompt().system_template;
    assert!(
        template.contains(&format!("Ruby {major_minor}")),
        "the Ruby prompt does not say it is Ruby {major_minor}, which is what the committed \
         compiler reports (`{level}`)"
    );
}

/// **`.rb`, and nothing else.**
///
/// One extension, like [Python](super::python)'s: the ECMAScript guest could evaluate this arm's
/// *compiled output*, but a skills directory holds sources, so a skill spelled `skill.js` is one
/// this arm's agents are not offered.
#[test]
fn a_code_skills_module_is_spelled_rb() {
    assert_eq!(ruby().module_file_extensions(), ["rb"]);
    assert_eq!(ruby().module_file_extension(), "rb");
}

/// **The `lib.<key>` binding is snake_case**, which is what this SDK spells everything else in.
///
/// Every case is a name a skill author really writes, and each has to come out as an identifier a
/// program can type from memory: separators collapse rather than doubling, case is folded, a leading
/// digit is prefixed, and a name with nothing usable in it still yields something.
#[test]
fn the_binding_name_is_snake_case() {
    assert_eq!(ruby().binding_name("csv-tools"), "csv_tools");
    assert_eq!(ruby().binding_name("my_helpers.v2"), "my_helpers_v2");
    assert_eq!(ruby().binding_name("CSV Tools"), "csv_tools");
    assert_eq!(ruby().binding_name("9lives"), "_9lives");
    assert_eq!(ruby().binding_name("--"), "module");
    assert_eq!(ruby().binding_name(""), "module");
}

/// **The synthesized file view is Ruby**: keyword arguments, and no terminator.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output. A trailing semicolon or a braced options object would teach it a habit
/// Ruby does not have, on turn one.
#[test]
fn the_synthesized_file_view_is_ruby() {
    assert_eq!(
        ruby().open_file_statement("src/main.rb", None),
        r#"GG::Views.open_file("src/main.rb")"#
    );
    assert_eq!(
        ruby().open_file_statement(
            "src/main.rb",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"GG::Views.open_file("src/main.rb", offset: 400, limit: 200)"#
    );
}

/// **The generated documentation program is Ruby** — an array and an `each` with a block, which is
/// how a Ruby programmer walks a list and deliberately not the `for` the language also has.
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. That it *compiles* is asserted next door, where a `node` is affordable; what
/// is asserted here is that gg wrote Ruby rather than another arm's syntax.
#[test]
fn the_generated_documentation_program_is_ruby() {
    assert_eq!(
        ruby().open_docs_views_statement(&["read_file", "write_file"]),
        "functions = [\n  \"read_file\",\n  \"write_file\",\n]\n\
         functions.each { |name| GG::Views.open_docs_view(name) }\n"
    );
}

/// **The committed catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::Ruby::catalogue) and panics, so reaching
/// for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong stem
/// would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_committed_catalogue_is_this_languages() {
    let catalogue = ruby().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Ruby);
    assert_eq!(catalogue.schema, crate::sandbox::SchemaVersion::V2);
    assert!(!catalogue.functions.is_empty());
    // The spelling that says the reflection is Ruby's rather than an ECMAScript arm's: a
    // module-qualified constant path, with the method reached through `.` as Ruby reaches a
    // module function.
    let read = ruby_function("files.read_file");
    assert_eq!(read.name, "read_file");
    assert_eq!(read.fqn, "GG::Files.read_file");
    assert_eq!(
        catalogue
            .modules
            .iter()
            .find(|module| module.id == "files")
            .map(|module| module.path.as_str()),
        Some("GG::Files"),
        "the filesystem module is spelled the way Ruby spells a namespace"
    );
}

/// The catalogued entry binding `operation`, which is gg's identity for it rather than this SDK's
/// spelling.
fn ruby_function(operation: &str) -> &'static crate::sandbox::signatures::FunctionSignature {
    ruby()
        .catalogue()
        .functions
        .iter()
        .find(|entry| entry.operation == operation && entry.alias_of.is_none())
        .unwrap_or_else(|| panic!("`{operation}` is catalogued"))
}

/// **This arm is the first registered language whose catalogue carries an entry with more than one
/// signature.**
///
/// A block is how a Ruby program passes a long body, and an overload group is how the catalogue says
/// so without claiming the function became two functions. The schema has carried the shape since the
/// seam was built; nothing produced one until now, and the
/// [agreement gate](super::agreement) is explicit that a signature *count* is spelling and is never
/// compared across arms.
#[test]
fn a_block_is_a_second_signature_rather_than_a_second_function() {
    let open_text = ruby_function("views.open_text");
    assert_eq!(
        open_text.signatures.len(),
        2,
        "`open_text` takes its body either as an argument or as a block: {:?}",
        open_text.signatures
    );
    assert!(
        open_text.signatures[1].signature.contains("&body"),
        "the second shape is the block form: {:?}",
        open_text.signatures[1]
    );

    // And the STRUCTURED half says so too. The rendered signature carried the `&` from the first
    // day; the parameter behind it was emitted as an ordinary positional `String`, so anything
    // reading the parameters rather than the string — the reference page's argument rows, a future
    // gate comparing calling conventions across arms — would have described a block as a value
    // written in the parentheses. Its type is the block's RETURN, because what a block is for is
    // the value it hands back.
    let body = &open_text.signatures[1].parameters[1];
    assert_eq!(body.name, "body");
    assert_eq!(
        body.kind,
        ParameterKind::Block,
        "a block is passed as a block, not by position: {body:?}"
    );
    assert_eq!(
        body.r#type, "-> String",
        "and it is typed by what it returns"
    );
    assert!(
        !body.optional,
        "the block form's block is the whole point of it"
    );

    // The other overload group on this arm agrees, so this is a property of the reflector rather
    // than of one hand-written entry.
    let write_file = ruby_function("files.write_file");
    let contents = &write_file.signatures[1].parameters[1];
    assert_eq!(contents.kind, ParameterKind::Block, "{contents:?}");

    // A splat stays positional, which is the distinction this variant is drawing: `*ranges` IS
    // passed by position and the `*` in the rendered signature says the rest. Only a block is a
    // second channel into the call.
    let archive = ruby_function("context.archive_thread");
    assert_eq!(
        archive.signatures[0].parameters[0].kind,
        ParameterKind::Positional,
        "a splat is positional: {:?}",
        archive.signatures[0].parameters[0]
    );
}

/// **Ruby's libraries are declared in its catalogue**, which is what the prompt renders.
///
/// The set is a bake-time fact about the committed component — `require "json"` works because the
/// build compiled `json` out of the pinned Opal's own sources — so the sentence a model reads is
/// reflected from the file that decides the set rather than written in a template. That the prompt
/// carries every group is a [prompt gate](crate::prompts); what is asserted here is that this arm
/// declares one at all, which is the half a prompt gate skips for a language that declares none.
#[test]
fn this_arm_declares_the_libraries_a_program_may_require() {
    let libraries = &ruby().catalogue().libraries;
    assert!(!libraries.is_empty(), "the Ruby arm declares a library set");
    assert!(
        libraries
            .iter()
            .any(|group| group.modules.iter().any(|module| module == "json")),
        "`json` is one of the baked libraries: {libraries:?}"
    );
}
