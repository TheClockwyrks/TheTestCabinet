//! What each [role](EndingRole) may declare, and how those declarations reach a tool-calling model.
//!
//! What *gates* an ending is no longer tested here: the validation commands moved to
//! [hooks](crate::hooks), and their tests with them. What is left is the part that was never
//! configurable — the calls themselves, and the feedback a turn that made none is given.

use super::*;

/// Each [role](EndingRole) is offered exactly its own ending calls, and each definition demands what
/// that role's verdict is made of — a change list that cannot be empty.
#[test]
fn role_tool_definitions_carry_each_role_s_shape() {
    let standard = role_tool_definitions(EndingRole::Standard);
    assert_eq!(
        standard.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [FINISH_TOOL]
    );

    let review = role_tool_definitions(EndingRole::Review);
    assert_eq!(
        review.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [APPROVE_TOOL, REQUEST_CHANGES_TOOL]
    );
    let items = &review[1].parameters["properties"]["items"];
    assert_eq!(
        items["minItems"], 1,
        "a rejection must name at least one change"
    );
}

/// The feedback for a text-only reply names the calls the reader actually has — never one its role
/// was not given.
#[test]
fn missing_completion_feedback_names_only_this_role_s_calls() {
    let standard = missing_completion_feedback(EndingRole::Standard);
    assert!(standard.contains(FINISH_TOOL), "{standard}");

    let review = missing_completion_feedback(EndingRole::Review);
    assert!(review.contains(APPROVE_TOOL), "{review}");
    assert!(review.contains(REQUEST_CHANGES_TOOL), "{review}");
    assert!(
        !review.contains(FINISH_TOOL),
        "a reviewer is never pointed at a `finish` it does not have: {review}"
    );
}

/// The finish tool is named `finish` and requires a `summary`.
#[test]
fn finish_tool_definition_names_finish_and_requires_summary() {
    let definition = &role_tool_definitions(EndingRole::Standard)[0];
    assert_eq!(definition.name, FINISH_TOOL);
    assert_eq!(
        definition.parameters["required"],
        json!(["summary"]),
        "the finish tool requires a summary",
    );
}
