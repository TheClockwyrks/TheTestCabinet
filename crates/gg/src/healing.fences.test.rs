//! Tests for `strip-fences`: the CommonMark scan with its two measured relaxations, the three-tier
//! candidacy ladder, the four-step decline ladder, and the disclosure each unwrap produces.
//!
//! This is the strategy every round-1 model needed, so most of these cases are committed replies
//! rather than invented ones. Where a case *is* invented it is because round 1 never produced the
//! shape — a doubly-fenced reply, an unrecognised tag — and inventing one is the only way to pin
//! behaviour that a future model will eventually exercise for real.

use super::tests::{
    DEEPSEEK_TURN_01, GEMINI_GLUED_CLOSE, GEMINI_TURN_01, GPT_TURN_01, HAIKU_TURN_01,
    HAIKU_TURN_03, dialect, healed,
};
use super::*;

/// The one `Fence` application a reply produced, or a failure naming what it produced instead.
fn fence_of(result: &Healed) -> HealingDetail {
    let fences: Vec<HealingDetail> = result
        .applied
        .iter()
        .filter(|application| application.strategy == HealingStrategy::StripFences)
        .map(|application| application.detail)
        .collect();
    assert_eq!(
        fences.len(),
        1,
        "expected exactly one fence application, got {:?}",
        result.applied
    );
    fences[0]
}

// ---------------------------------------------------------------------------------------------
// Unwrapping
// ---------------------------------------------------------------------------------------------

/// The ordinary case: one tagged fence around the program.
#[test]
fn a_tagged_fence_is_unwrapped() {
    let result = healed("```ts\nconst files = listDir(\"src\");\nreturn files.length;\n```");
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 0,
            ignored_code: 0
        }
    );
}

/// A fence with no info string at all is still a fence — tier 2 of the candidacy ladder.
#[test]
fn an_untagged_fence_is_unwrapped() {
    let result = healed("```\nconst x = 1;\nreturn x;\n```");
    assert_eq!(result.program, "const x = 1;\nreturn x;");
    assert_eq!(result.strategies(), vec![HealingStrategy::StripFences]);
}

/// Every tag gg recognises as "this block is the program" works, not just `ts`.
///
/// The list is closed on purpose — a `json` or `bash` block is context the model showed — so the
/// recognised spellings have to be broad enough that a model writing `tsx` or `node` is not refused.
#[test]
fn a_recognised_non_ts_program_tag_is_unwrapped() {
    for tag in ["tsx", "mts", "node", "es6", "TypeScript", "JavaScript"] {
        let result = healed(&format!("```{tag}\nconst x = 1;\nreturn x;\n```"));
        assert_eq!(result.program, "const x = 1;\nreturn x;", "tag {tag}");
    }
}

/// Tier 3: a lone block tagged something gg has never heard of, whose body is plainly code, still
/// runs — which is what stops the closed tag list from being a trap.
#[test]
fn a_single_block_with_an_unrecognised_tag_is_run_when_its_body_is_code() {
    let result = healed("```code\nconst x = 1;\nreturn x;\n```");
    assert_eq!(result.program, "const x = 1;\nreturn x;");
    assert_eq!(result.strategies(), vec![HealingStrategy::StripFences]);
}

/// An illustrative block beside the program does not make the reply ambiguous: the tagged program
/// wins, the other is left where it was, and the model is told it was left.
#[test]
fn a_non_program_tag_beside_a_program_block_is_ignored_not_run() {
    let result = healed(
        "Here is what the tool printed:\n\n\
         ```text\nsrc entries\n```\n\n\
         ```ts\nwriteFile(\"MANIFEST.md\", \"ok\");\n```",
    );
    assert_eq!(result.program, "writeFile(\"MANIFEST.md\", \"ok\");");
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 1,
            ignored_code: 0
        }
    );
}

/// A left-behind block that **looked like code** is recorded as such, because that is the one shape
/// where the repair understates what happened: part of what the model sent did not run.
///
/// It is a *record*, not a message. Healing is invisible to the model — a repaired reply is simply
/// the reply that runs — so what this fact feeds is the telemetry a study reads, never a paragraph
/// at the top of a turn explaining what gg did to the model's words.
#[test]
fn an_ignored_block_that_looked_like_code_is_recorded() {
    let result = healed(
        "The manifest currently reads:\n\n\
         ```json\n{\n  \"name\": \"x\"\n}\n```\n\n\
         ```ts\nwriteFile(\"MANIFEST.md\", \"ok\");\n```",
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 1,
            ignored_code: 1
        }
    );
}

/// A reply made only of blocks gg does not read as programs is left exactly as it was: there is no
/// candidate to unwrap to, and inventing one would delete the rest.
#[test]
fn a_reply_of_only_non_program_blocks_is_left_alone() {
    let reply = "Here is what I found.\n\n\
                 ```json\nnull\n```\n\n\
                 ```text\nsrc entries\n```";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// An opening fence that is never closed runs to the end of the response.
///
/// Half a fenced block is still the model's whole program, and abandoning the scan would refuse a
/// turn that gg can read perfectly well.
#[test]
fn an_unterminated_fence_runs_to_the_end_of_the_response() {
    let result = healed(
        "Here is the program:\n\n```ts\nconst files = listDir(\"src\");\nreturn files.length;",
    );
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Unterminated,
            ignored: 0,
            ignored_code: 0
        }
    );
}

// ---------------------------------------------------------------------------------------------
// The round-1 replies
// ---------------------------------------------------------------------------------------------

/// **The malformed close that made a round-1 session unrecoverable.**
///
/// A closing fence with a sentence on the same line does not close a block under CommonMark, so the
/// old extractor swallowed the sentence into the program, `oxc` rejected it, and the model — shown a
/// diagnostic it could not place — re-emitted the same reply the next turn. Healing ends the block
/// there, keeps the four statements the model wrote, and tells it what happened.
#[test]
fn the_round_one_glued_closing_fence_is_healed() {
    let result = healed(GEMINI_GLUED_CLOSE);
    assert_eq!(
        result.program,
        "const entries = listDir(\"src\");\n\
         console.log(\"src entries:\", JSON.stringify(entries));\n\
         const lsResult = shell(\"find src -type f\");\n\
         console.log(\"find output:\\n\", lsResult.output);"
    );
    assert!(
        !result.program.contains("Consumed fuel"),
        "the glued sentence was read as program text:\n{}",
        result.program
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Glued,
            ignored: 0,
            ignored_code: 0
        }
    );
}

/// The glued **open** — a sentence and the next fence on one line — is recognised as opening a
/// block, so the reply is seen for what it is: two candidate programs, not one.
///
/// Under the old extractor the second block was invisible: the first ran, the second was silently
/// discarded, and the model narrated work that never happened.
#[test]
fn the_round_one_glued_opening_fence_is_recognised() {
    let result = healed(DEEPSEEK_TURN_01);
    assert_eq!(
        result.program,
        DEEPSEEK_TURN_01.trim(),
        "a two-candidate reply was unwrapped to one of them"
    );
    assert!(result.applied.is_empty(), "{:?}", result.applied);
    let scan = scan_fences(DEEPSEEK_TURN_01.trim(), dialect());
    assert_eq!(scan.blocks.len(), 2, "the glued opener was swallowed");
    assert!(
        scan.outside
            .iter()
            .any(|line| line.contains("Now run the shell command to confirm.")),
        "the prose glued to the fence was read as program text"
    );
}

/// **The four multi-block turn-1 replies, measured against the committed captures.**
///
/// gg does not guess which of the candidates was meant, and it does not refuse the turn over its own
/// count of them either: it rewrites nothing, and the reply the type-strip compiles is the reply the
/// model sent.
#[test]
fn several_program_blocks_are_neither_guessed_at_nor_refused() {
    let cases = [
        ("round1-haiku-turn-01", HAIKU_TURN_01, 2),
        ("round1-gpt-turn-01", GPT_TURN_01, 5),
        ("round1-gemini-turn-01", GEMINI_TURN_01, 7),
        ("round1-deepseek-turn-01", DEEPSEEK_TURN_01, 2),
    ];
    for (name, reply, blocks) in cases {
        assert_eq!(
            candidate_blocks(&scan_fences(reply.trim(), dialect()).blocks, dialect()).len(),
            blocks,
            "{name}: the fixture no longer offers this many candidates"
        );
        let result = healed(reply);
        assert_eq!(
            result.program,
            reply.trim(),
            "{name}: the reply was rewritten"
        );
        assert!(result.applied.is_empty(), "{name}: {:?}", result.applied);
    }
}

/// A reply that satisfies **both** declines at once — several candidates *and* a code-shaped line
/// outside every fence — is still left exactly as it was.
#[test]
fn several_candidates_with_outside_code_still_decline() {
    let both = "const plan = 1;\n\n\
                ```ts\nwriteFile(\"a.txt\", \"a\");\n```\n\n\
                ```ts\nwriteFile(\"b.txt\", \"b\");\n```";
    assert!(
        scan_fences(both, dialect())
            .outside
            .iter()
            .any(|line| dialect().looks_like_code(line)),
        "the fixture no longer satisfies decline 3"
    );
    let result = healed(both);
    assert_eq!(result.program, both);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// The positive case, on the reply that actually produced it: prose, one block, prose — healed to
/// exactly the block's body and nothing else.
#[test]
fn a_real_single_block_response_heals_to_exactly_its_program() {
    let result = healed(HAIKU_TURN_03);
    let block = &scan_fences(HAIKU_TURN_03.trim(), dialect()).blocks[0];
    assert_eq!(result.program, block.body);
    assert!(
        result
            .program
            .starts_with("const srcFiles = listDir(\"src\");")
    );
    assert!(
        result
            .program
            .ends_with("return { success: true, filesListed: fileDetails.length };")
    );
    assert!(
        !result.program.contains("I see the issue"),
        "the leading prose survived"
    );
    assert!(
        !result.program.contains("has been created"),
        "the trailing prose survived"
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 0,
            ignored_code: 0
        }
    );
}

// ---------------------------------------------------------------------------------------------
// Declining
// ---------------------------------------------------------------------------------------------

/// **Decline 3, above the fence.** A program that writes a Markdown fence into a file is a program
/// with a fence *inside* it, not a program *wrapped* in one — real code survives outside the block,
/// so unwrapping would delete it.
#[test]
fn a_program_that_writes_a_markdown_fence_is_left_alone() {
    let reply =
        "writeFile(\"README.md\", `# How to run\n\n```ts\nconst x = 1;\n```\n`);\nreturn 1;";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// **Decline 3, below the fence.** A model that fences half its program and carries on underneath
/// has written one program across a fence, not a program wrapped in one — so nothing is unwrapped
/// and nothing is deleted.
///
/// The unwrap keeps only the candidate block's body, and [`HealingDetail::Fence`] counts other
/// *blocks* rather than outside lines, so unwrapping here would drop the trailing statements with no
/// note saying so. That is the round-1 failure — the silent discard of the half of the reply that
/// did the work — in a new shape, and the decline is what makes it unreachable.
#[test]
fn code_after_the_fence_stops_the_unwrap() {
    let reply = "```ts\nconst a = 1;\n```\nconst b = 2;\nreturn a + b;";
    let result = healed(reply);
    assert_eq!(
        result.program, reply,
        "the trailing statements were deleted"
    );
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// The same decline on the shape that costs the most: the `finish` call written under the fence.
///
/// Deleting it is worse than deleting any other statement, because the run then has no way to end.
/// The write lands, the turn feedback reports it and asks the model to call `finish`, the model
/// believes it already did, and the session burns to its turn ceiling — a self-sustaining loop gg
/// would have caused and never disclosed.
#[test]
fn a_finish_outside_the_fence_is_never_deleted() {
    let reply =
        "```ts\nwriteFile(\"MANIFEST.md\", \"- a.ts\\n\");\n```\nfinish(\"wrote the manifest\");";
    let result = healed(reply);
    assert!(
        result.program.contains("finish(\"wrote the manifest\");"),
        "the completion was healed away:\n{}",
        result.program
    );
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A glued close that pushes real code outside the block declines too.
///
/// This is the shape where an unwrap does the most damage: the block's body is the model's *prose*,
/// so unwrapping would keep the narration and delete every statement the model wrote.
#[test]
fn a_glued_close_that_exposes_code_declines() {
    let reply = "```ts\nStarting now.\n```ts\nconst a = 1;\n```\n```\nreturn a;";
    let result = healed(reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
    assert!(
        result.program.contains("const a = 1;"),
        "{}",
        result.program
    );
    assert!(result.program.contains("return a;"), "{}", result.program);
}

/// A four-backtick wrapper survives the three-backtick fence it contains — CommonMark's own rule for
/// exactly this case, and the one that stops a program writing a README from being cut in half.
#[test]
fn a_four_backtick_wrapper_survives_the_fence_it_contains() {
    let result = healed(
        "Writing the README:\n\n\
         ````ts\n\
         writeFile(\"README.md\", `# Game\n\n\
         ```sh\nnpm run dev\n```\n\
         `);\n\
         return 1;\n\
         ````",
    );
    assert!(
        result.program.contains("```sh") && result.program.contains("return 1;"),
        "the program was cut at its inner fence:\n{}",
        result.program
    );
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 0,
            ignored_code: 0
        }
    );
}

/// Escaped backticks inside a template literal are single backticks, so they never form a run long
/// enough to be a fence — and a program that generates Markdown is left exactly as written.
#[test]
fn escaped_backticks_in_a_template_literal_are_not_a_fence() {
    let reply = "const lang = \"ts\";\n\
                 const doc = `Example:\n\n\
                 \\`\\`\\`${lang}\n\
                 const x = 1;\n\
                 \\`\\`\\`\n\
                 `;\n\
                 writeFile(\"doc.md\", doc);";
    assert!(
        scan_fences(reply, dialect()).blocks.is_empty(),
        "an escaped backtick run was read as a fence"
    );
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// Four spaces of indentation is an indented code block, not a fence — so gg does not unwrap one,
/// and does not mistake the lines around it for a wrapper it removed.
///
/// Both positions are exercised, because only one of them is hard. A fence indented *inside* a reply
/// is scanned as written; a fence indented on the reply's **first line** is the case a plain
/// `trim()` on entry would have silently un-indented, turning it into a fence, reporting an unwrap
/// that repaired nothing and leaving the still-indented closing run inside the program. That is why
/// entry canonicalisation keeps the first content line's indentation.
#[test]
fn a_fence_indented_four_spaces_is_not_a_fence() {
    for reply in [
        "const kept = 1;\n    ```ts\n    const x = 1;\n    ```",
        "    ```ts\n    const x = 1;\n    ```",
        "\n\n    ```ts\n    const x = 1;\n    ```\n",
    ] {
        let canonical = trim_reply(reply);
        assert!(
            scan_fences(canonical, dialect()).blocks.is_empty(),
            "an indented fence was scanned as a fence: {reply:?}"
        );
        let result = healed(reply);
        assert_eq!(
            result.program, canonical,
            "{reply:?} was rewritten rather than left alone"
        );
        assert!(result.applied.is_empty(), "{reply:?}: {:?}", result.applied);
    }
}

/// A lead-in sentence containing a semicolon does not read as code, so it does not block the unwrap.
///
/// English uses semicolons. Without the narrowing that only a *statement-terminating* `;` counts, one
/// semicolon in a model's opening sentence would disable fence stripping for the whole reply.
#[test]
fn prose_containing_a_semicolon_does_not_block_the_unwrap() {
    let lead = "Here is the plan; I will list the files.";
    assert!(
        !dialect().looks_like_code(lead),
        "an English semicolon read as code"
    );
    let result = healed(&format!(
        "{lead}\n\n```ts\nconst files = listDir(\"src\");\nreturn files;\n```"
    ));
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files;"
    );
}

/// A prose line opening with an inline code span does not read as code either — models write them
/// constantly, and a template-literal continuation line that genuinely is code is caught by the
/// line-ending clause instead.
#[test]
fn prose_starting_with_an_inline_code_span_does_not_block_the_unwrap() {
    let lead = "`index.ts`: I will rewrite it.";
    assert!(
        !dialect().looks_like_code(lead),
        "an inline code span read as code"
    );
    let result = healed(&format!(
        "{lead}\n\n```ts\nwriteFile(\"index.ts\", \"ok\");\n```"
    ));
    assert_eq!(result.program, "writeFile(\"index.ts\", \"ok\");");
}

// ---------------------------------------------------------------------------------------------
// Repeats and line endings
// ---------------------------------------------------------------------------------------------

/// A fence inside a fence unwraps twice, and both applications are reported: the count is what makes
/// "how often did this model wrap its program" a measurement rather than a flag.
#[test]
fn a_doubly_fenced_response_unwraps_twice_and_says_so() {
    let result = healed("````md\n```ts\nconst x = 1;\nreturn x;\n```\n````");
    assert_eq!(result.program, "const x = 1;\nreturn x;");
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::StripFences, HealingStrategy::StripFences]
    );
    assert_eq!(result.applied.len(), 2);
}

/// A reply written with Windows line endings heals like any other, and the program keeps the
/// endings the model wrote: healing slices the response rather than re-joining its lines.
#[test]
fn a_reply_with_windows_line_endings_heals_and_keeps_them() {
    let result =
        healed("Here is the program:\r\n\r\n```ts\r\nconst x = 1;\r\nreturn x;\r\n```\r\n");
    assert_eq!(result.program, "const x = 1;\r\nreturn x;");
    assert_eq!(
        fence_of(&result),
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 0,
            ignored_code: 0
        }
    );
}

// ---------------------------------------------------------------------------------------------
// Dedenting the body
// ---------------------------------------------------------------------------------------------

/// A fence a model indented yields a program at the margin, with **every** line moved by the same
/// amount.
///
/// The shape is ordinary — a block under a numbered step, which is how a model writes "first do
/// this" — and it is the one a `trim()` on the body gets wrong in the worst possible way: line 1
/// comes out flush and every line after it keeps the indent, so the program gg runs is one gg
/// misaligned. In a language where indentation is punctuation the model is then shown an
/// unexpected-indent error over text it never wrote.
#[test]
fn an_indented_fence_dedents_its_whole_body() {
    let result = healed(
        "1. First, list the files:\n\n   ```ts\n   const files = listDir(\"src\");\n   return \
         files.length;\n   ```\n",
    );
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::StripFences]);
}

/// A body indented further than its fence is dedented too — by what its own lines share, not by
/// what CommonMark would allow off the fence.
///
/// CommonMark removes only as much indentation as the opening fence carried, which would leave a
/// block indented under a flush fence exactly as misaligned as before. What matters to a program is
/// that its lines start at the margin, so the shared prefix is what goes.
#[test]
fn a_body_indented_past_its_fence_is_dedented_by_what_its_lines_share() {
    let result = healed("```ts\n    const x = 1;\n    return x;\n```");
    assert_eq!(result.program, "const x = 1;\nreturn x;");
}

/// Dedenting is uniform, so a body's **relative** indentation survives it intact — which is the
/// whole of what a whitespace-significant language reads.
#[test]
fn dedenting_keeps_the_relative_indentation_of_a_nested_block() {
    let result = healed(
        "  ```ts\n  const files = listDir(\"src\");\n  for (const file of files) {\n    \
         view.openFile(file);\n  }\n  ```",
    );
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nfor (const file of files) {\n  view.openFile(file);\n}"
    );
}

/// A blank line inside an indented body is not consulted for the shared prefix — it has no
/// indentation to share — and is not left holding the indent everything else gave up.
#[test]
fn a_blank_line_does_not_hold_an_indented_body_back() {
    let result = healed("  ```ts\n  const x = 1;\n\n  return x;\n  ```");
    assert_eq!(result.program, "const x = 1;\n\nreturn x;");
}

/// A body whose lines share nothing is left exactly as the model wrote it: a block that is already
/// at the margin has no indentation to remove, and one line of it starting further left than the
/// rest lowers the shared prefix to nothing rather than shifting anything.
#[test]
fn a_body_that_shares_no_indentation_is_untouched() {
    let result = healed("```ts\nconst x = 1;\n    return x;\n```");
    assert_eq!(result.program, "const x = 1;\n    return x;");
}

/// An indented body written with Windows line endings dedents and keeps its endings: the dedent
/// removes leading whitespace and nothing else.
#[test]
fn an_indented_body_with_windows_line_endings_dedents_and_keeps_them() {
    let result = healed("  ```ts\r\n  const x = 1;\r\n  return x;\r\n  ```\r\n");
    assert_eq!(result.program, "const x = 1;\r\nreturn x;");
}

/// Prose above an indented program dedents it too. `strip-prose` deletes whole lines, so without a
/// dedent of its own it would hand back a program still carrying the lead-in's indentation on every
/// line but the first.
#[test]
fn stripping_prose_dedents_what_it_leaves() {
    let result = healed(
        "Here is what I will do.\n\n  const files = listDir(\"src\");\n  return files.length;\n",
    );
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert!(
        result.strategies().contains(&HealingStrategy::StripProse),
        "{:?}",
        result.applied
    );
}
