use test_cabinet_core::gg::GgProgramLanguage;

use super::*;

/// Build every registered arm's fixture once for the assertions below.
fn fixtures() -> Vec<ProbeFixture> {
    GgProgramLanguage::ALL
        .iter()
        .map(|id| fixture_for(*id).unwrap_or_else(|err| panic!("{}: {err}", id.id())))
        .collect()
}

#[test]
fn every_language_projects_a_fixture_with_both_scenarios_and_at_least_three_prompts() {
    for fixture in fixtures() {
        let scenarios: std::collections::BTreeSet<&str> =
            fixture.cases.iter().map(|case| case.scenario).collect();
        assert_eq!(
            scenarios.into_iter().collect::<Vec<_>>(),
            vec!["baseline", "missing-docview"],
            "{}: the two scenarios",
            fixture.language
        );
        let prompts: std::collections::BTreeSet<&str> =
            fixture.cases.iter().map(|case| case.prompt).collect();
        assert!(
            prompts.len() >= 3,
            "{}: at least three distinct input prompts, got {prompts:?}",
            fixture.language
        );
    }
}

#[test]
fn every_case_is_a_wellformed_turn1_conversation() {
    for fixture in fixtures() {
        for case in &fixture.cases {
            let name = format!("{}/{}/{}", fixture.language, case.scenario, case.prompt);
            assert_eq!(
                case.messages.first().map(|m| m.role),
                Some("system"),
                "{name}: opens on the system prompt"
            );
            let last = case.messages.last().unwrap();
            assert_eq!(last.role, "system", "{name}: ends on the contract notice");
            assert!(
                last.content
                    .as_deref()
                    .is_some_and(|c| c.contains("submit_program")),
                "{name}: the trailing notice restates the call contract"
            );
            // Every synthesized submission is answered by its own `ok`.
            for message in &case.messages {
                for call in &message.tool_calls {
                    assert_eq!(call.function.name, "submit_program", "{name}");
                    let arguments: serde_json::Value =
                        serde_json::from_str(&call.function.arguments).unwrap();
                    assert!(
                        arguments["program"].is_string(),
                        "{name}: a synthesized call carries its program"
                    );
                    assert!(
                        case.messages.iter().any(|m| m.role == "tool"
                            && m.tool_call_id.as_deref() == Some(call.id)),
                        "{name}: call `{}` is acknowledged",
                        call.id
                    );
                }
            }
        }
    }
}

#[test]
fn a_file_view_heading_carries_the_total_line_count_and_the_whole_file() {
    for fixture in fixtures() {
        for case in &fixture.cases {
            let view = case
                .messages
                .iter()
                .find(|m| m.source == "file_view")
                .unwrap_or_else(|| panic!("{}: a file view is seeded", fixture.language));
            let content = view.content.as_deref().unwrap();
            let heading = content.lines().next().unwrap();
            // `File: specs/x.md:1-N of N lines`, with the body's line count matching N.
            let total = content
                .split_once("\n----\n")
                .map(|(_, body)| body.lines().count())
                .unwrap();
            assert_eq!(
                heading,
                format!(
                    "File: {}:1-{total} of {total} lines",
                    heading
                        .strip_prefix("File: ")
                        .unwrap()
                        .split(':')
                        .next()
                        .unwrap()
                ),
                "{}/{}: the heading states the whole range and the total",
                fixture.language,
                case.prompt
            );
        }
    }
}

#[test]
fn baseline_cases_open_the_documentation_of_every_expected_call() {
    for fixture in fixtures() {
        for case in fixture.cases.iter().filter(|c| c.scenario == "baseline") {
            assert!(
                !case.expected_calls.is_empty(),
                "{}/{}: a baseline case names its calls",
                fixture.language,
                case.prompt
            );
            // One docview per expected call: the case's docview keys are opened in the
            // conversation (the docview messages' headings carry the keys).
            let headings: Vec<&str> = case
                .messages
                .iter()
                .filter(|m| m.source == "docs_view")
                .filter_map(|m| m.content.as_deref())
                .filter_map(|c| c.lines().next())
                .collect();
            assert!(
                case.expected_calls.len() <= headings.len(),
                "{}/{}: at least one documentation view per expected call",
                fixture.language,
                case.prompt
            );
        }
    }
}

#[test]
fn missing_docview_cases_withhold_the_target_and_name_the_open_call() {
    for fixture in fixtures() {
        for case in fixture
            .cases
            .iter()
            .filter(|c| c.scenario == "missing-docview")
        {
            let name = format!("{}/{}", fixture.language, case.prompt);
            let key = case.docview_key.as_deref().unwrap();
            assert!(
                case.docview_call.is_some(),
                "{name}: the docview-opening call is named"
            );
            assert_eq!(case.forbidden_calls.len(), 1, "{name}");
            // The target's documentation view is NOT open in the conversation.
            for message in &case.messages {
                if message.source == "docs_view" {
                    let heading = message.content.as_deref().unwrap().lines().next().unwrap();
                    assert_ne!(
                        heading,
                        format!("Documentation: {key}"),
                        "{name}: the target's docview must be missing"
                    );
                }
            }
        }
    }
}

#[test]
fn the_system_prompt_states_the_docview_discipline_the_probe_measures() {
    // The missing-docview scenario scores a model against an instruction the prompt actually
    // carries; if the sentence is reworded, the probe's premise changed and this fails first.
    for fixture in fixtures() {
        let system = fixture.cases[0].messages[0].content.as_deref().unwrap();
        assert!(
            system.contains(
                "Open a documentation view of each function you intend to call, and write\nthe \
                 call on a later turn."
            ),
            "{}: the prompt instructs docview-before-call",
            fixture.language
        );
    }
}

#[test]
fn the_projection_writes_one_file_per_language() {
    let dir = std::env::temp_dir().join(format!("gg-probe-fixtures-{}", std::process::id()));
    write_probe_fixtures(&dir).unwrap();
    for id in GgProgramLanguage::ALL {
        let path = dir.join(format!("{}.json", id.id()));
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["language"], id.id());
        assert!(parsed["cases"].as_array().is_some_and(|c| c.len() == 4));
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_call_needle_is_the_spellings_last_two_segments() {
    assert_eq!(call_needle("gg.files.writeFile"), "files.writeFile");
    assert_eq!(call_needle("gg::files::write_file"), "files::write_file");
    assert_eq!(call_needle("gg.files.Files.editFile"), "Files.editFile");
    assert_eq!(call_needle("GG::Files.edit_file"), "Files.edit_file");
    assert_eq!(call_needle("Gg.Views.openDocsView"), "Views.openDocsView");
    assert_eq!(call_needle("finish"), "finish");
    assert_eq!(call_needle("session.finish"), "session.finish");
}
