# frozen_string_literal: true

module GG
  # The `project` family: the epic/issue board.
  #
  # An issue is the heavyweight unit of work — scope, non-scope and completion criteria are exactly
  # what a delegated child agent is briefed from — which is why `create_issue` asks for more than
  # `add_task` does. Its five required arguments are positional, and the four that shape it are
  # keywords, which is what a call with this many strings in it should look like in Ruby.
  #
  # Three lowerings live here, all of the same kind: a model writes `UNCHANGED` / `nil` / a value
  # and the wrapper turns that into the membrane's tagged variant. `description` is a three-way
  # text edit, `epic_id` is a three-way epic assignment (leave it out to keep the grouping, `nil`
  # to ungroup, an id to regroup), and a status is a Symbol on this side and `in-progress` on the
  # other.
  #
  # @api private
  module Board
    # Lower the `UNCHANGED` / `nil` / id sentinel onto the membrane's epic assignment.
    #
    # @param value [String, nil, Symbol] `UNCHANGED`, `nil`, or an epic id
    # @return [Object] the membrane's `epic-assignment` variant
    def self.epic_edit(value)
      return Wire.variant("keep") if value.equal?(UNCHANGED)
      return Wire.variant("ungroup") if value.nil?

      Wire.variant("set", value)
    end

    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [BoardUsage] the budget a program reads
    def self.usage(usage)
      BoardUsage.new(
        epics: Wire.field(usage, "epics"),
        max_epics: Wire.field(usage, "maxEpics"),
        issues: Wire.field(usage, "issues"),
        max_issues: Wire.field(usage, "maxIssues")
      )
    end

    # Create an epic to group related issues, and return the id it took and the board budget.
    #
    # `prefix` is upper-cased and becomes the epic's id, which is also what its issues are numbered
    # from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and so on.
    #
    # @param prefix [String] 3-6 letters naming it. Upper-cased, it becomes the epic's id and the
    #   stem its issues are numbered from.
    # @param title [String] A short line naming the body of work.
    # @param description [String] What the epic covers, for a reader who has not seen its issues.
    # @return [EpicCreated] the id the prefix resolved to, and the board budget
    # @raise [ToolError] `:invalid_argument` when the prefix is not 3-6 letters, and `:conflict`
    #   when another epic already holds it.
    def self.create_epic(prefix, title, description)
      created = Wire.call("create_epic", "board", "createEpic", [
                            Wire.record("prefix" => prefix, "title" => title,
                                        "description" => description)
                          ])
      EpicCreated.new(id: Wire.field(created, "id"), board: usage(`#{created}.board`))
    end

    # Create a self-contained, dispatchable issue, and return the id the board **assigned** it.
    #
    # The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it
    # has no epic; you do not choose it, so keep the returned one to block a later issue on this
    # one or to wait for it. `in_scope`, `out_of_scope` and `completion_criteria` are what a child
    # agent is briefed from, so write them for a reader with no other context.
    #
    # @param title [String] A short line naming the work.
    # @param in_scope [String] What the issue covers, precisely. Part of the brief a child agent is
    #   given.
    # @param out_of_scope [String] What the issue deliberately does not cover, so the work stops
    #   where you meant it to.
    # @param completion_criteria [String] What must be true for the issue to be done. It is what a
    #   reviewer checks the work against.
    # @param agent [String] The agent the issue is dispatched to. It must be one you may spawn.
    # @param description [String, nil] What the work is. Written for a child agent with no other
    #   context.
    # @param blocked_by [Array<String>] The ids of every issue that must be done before this one.
    #   Defaults to none.
    # @param epic_id [String, nil] The id of an existing epic to group it under. Leave it out to
    #   leave it ungrouped and numbered under `ISSUE`.
    # @param reviewers [Array<String>] The agents that must approve the work, from the same set you
    #   may spawn. Required when this run's reviewers feature is on.
    # @return [IssueCreated] the id the board assigned, and the board budget
    # @raise [ToolError] `:invalid_argument` when `agent` or a reviewer is not yours to assign, and
    #   `:conflict` on a blocker edge that would close a cycle.
    def self.create_issue(title, in_scope, out_of_scope, completion_criteria, agent,
                          description: nil, blocked_by: [], epic_id: nil, reviewers: [])
      created = Wire.call("create_issue", "board", "createIssue", [
                            Wire.record(
                              "title" => title,
                              "description" => description,
                              "inScope" => in_scope,
                              "outOfScope" => out_of_scope,
                              "completionCriteria" => completion_criteria,
                              "blockedBy" => Check.strings("create_issue", "blocked_by",
                                                           blocked_by),
                              "epicId" => epic_id,
                              "agent" => agent,
                              "reviewers" => Check.strings("create_issue", "reviewers", reviewers)
                            )
                          ])
      IssueCreated.new(id: Wire.field(created, "id"), board: usage(`#{created}.board`))
    end

    # Revise an issue; supply at least one field.
    #
    # @param id [String] The issue to revise.
    # @param title [String, nil] The title to replace the old one with. Leave it out to keep the
    #   one it has.
    # @param description [String, nil, Unchanged] The description to replace the old one with; `nil`
    #   clears it, and leaving it out (or passing `UNCHANGED`) keeps the one it has.
    # @param in_scope [String, nil] The scope statement to replace the old one with.
    # @param out_of_scope [String, nil] The non-scope statement to replace the old one with.
    # @param completion_criteria [String, nil] The completion criteria to replace the old ones
    #   with.
    # @param status [Symbol, nil] Where the issue now stands — one of `IssueStatus`'s symbols.
    #   Leave it out to keep the status it has.
    # @param epic_id [String, nil, Unchanged] The epic to regroup it under; `nil` detaches it from the
    #   one it has, and leaving it out (or passing `UNCHANGED`) keeps the grouping.
    # @return [nil] nothing; the revision either happened or raised
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.update_issue(id, title: nil, description: UNCHANGED, in_scope: nil,
                          out_of_scope: nil, completion_criteria: nil, status: nil,
                          epic_id: UNCHANGED)
      Wire.call("update_issue", "board", "updateIssue", [
                  id,
                  Wire.record(
                    "title" => title,
                    "description" => Wire.text_edit(description),
                    "inScope" => in_scope,
                    "outOfScope" => out_of_scope,
                    "completionCriteria" => completion_criteria,
                    "status" => Wire.arm(Check.choice("update_issue", "status", status,
                                                      IssueStatus::ALL)),
                    "epic" => epic_edit(epic_id)
                  )
                ])
      nil
    end

    # Replace an issue's whole blocker set; no arguments clears every blocker.
    #
    # @param id [String] The issue whose blockers to replace.
    # @param blocked_by [Array<String>] The ids of every issue that must now be done before it,
    #   splatted. Passing none clears them all.
    # @return [nil] nothing; the replacement either happened or raised
    # @raise [ToolError] `:not_found` for an unknown id, and `:conflict` when an edge would close a
    #   cycle.
    def self.set_issue_blocked_by(id, *blocked_by)
      Wire.call("set_issue_blocked_by", "board", "setIssueBlockedBy",
                [id, Check.strings("set_issue_blocked_by", "blocked_by", blocked_by)])
      nil
    end

    # Remove an epic, keeping its issues and ungrouping them, and return the board budget.
    #
    # @param id [String] The epic to remove.
    # @return [BoardUsage] how much of the board budget is still used
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.remove_epic(id)
      usage(Wire.call("remove_epic", "board", "removeEpic", [id]))
    end

    # Remove an issue and every blocker edge pointing at it, and return the board budget.
    #
    # @param id [String] The issue to remove.
    # @return [BoardUsage] how much of the board budget is still used
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.remove_issue(id)
      usage(Wire.call("remove_issue", "board", "removeIssue", [id]))
    end

    # Register a wait on an issue and return an acknowledgement.
    #
    # It does not block inside your program — it records the wait and returns at once, so the rest
    # of your program still runs; the suspension happens after the program ends, between turns.
    # Once the program finishes the run suspends, freeing this agent's slot for others, until the
    # issue is terminal (done, or failed if its assigned agent could not complete it), then resumes
    # on the next turn. Use it to sequence your next turn's work behind an issue you depend on.
    #
    # @param id [String] The issue to wait on. It may not be the issue you were assigned to
    #   implement.
    # @return [String] the acknowledgement, which says what will happen after your program ends
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.wait_for_issue(id)
      Wire.call("wait_for_issue", "board", "waitForIssue", [id])
    end
  end
end
