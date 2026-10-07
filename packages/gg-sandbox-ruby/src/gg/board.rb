# frozen_string_literal: true

module GG
  # The epic and issue board, on which work is decomposed into dispatchable units.
  #
  # An issue is self-contained: it carries its own scope, non-scope and completion criteria, which
  # is what a child agent is briefed from.
  #
  # A description is a three-way edit and an epic id a three-way assignment: `GG::Core::UNCHANGED`,
  # or leaving the argument out, keeps what is there; `nil` clears it; a value replaces it.
  module Board
    extend Surface::Operations

    # Lower the unchanged/clear/set sentinel onto the membrane's epic assignment.
    #
    # @param value [String, nil, Symbol] `GG::Core::UNCHANGED`, `nil`, or an epic id
    # @return [Object] the membrane's `epic-assignment` variant
    # @api private
    def self.epic_edit(value)
      return Wire.variant("keep") if value.equal?(Core::UNCHANGED)
      return Wire.variant("ungroup") if value.nil?

      Wire.variant("set", value)
    end
    private_class_method :epic_edit

    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [GG::Board::BoardUsage] the budget a program reads
    # @api private
    def self.usage(usage)
      BoardUsage.new(
        epics: Wire.field(usage, "epics"),
        max_epics: Wire.field(usage, "maxEpics"),
        issues: Wire.field(usage, "issues"),
        max_issues: Wire.field(usage, "maxIssues")
      )
    end
    private_class_method :usage

    # Create an epic to group related issues, and hand back the id it took.
    #
    # `prefix` is upper-cased and becomes the epic's id, which is also the stem its issues are
    # numbered from: a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and so on.
    #
    # @param prefix [String] Three to six letters naming it. Upper-cased, it becomes the epic's id
    #   and the stem its issues are numbered from.
    # @param title [String] A short line naming the body of work.
    # @param description [String] What the epic covers, for a reader who has not seen its issues.
    # @return [GG::Board::EpicCreated] the id the prefix resolved to, and the board budget
    # @raise [GG::Core::ApiError] `:invalid_argument` when the prefix is not three to six letters,
    #   and `:conflict` when another epic already holds it.
    def self.create_epic(prefix, title, description)
      created = Wire.call("create_epic", "board", "createEpic", [
                            Wire.record("prefix" => prefix, "title" => title,
                                        "description" => description)
                          ])
      EpicCreated.new(id: Wire.field(created, "id"), board: usage(`#{created}.board`))
    end
    operation :create_epic, "board.create_epic", tool: "create_epic"

    # Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
    #
    # The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it
    # has no epic. It is the board's to choose.
    #
    # @param title [String] A short line naming the work.
    # @param in_scope [String] What the issue covers, precisely. Part of the brief a child agent is
    #   given.
    # @param out_of_scope [String] What the issue deliberately does not cover.
    # @param completion_criteria [String] What must be true for the issue to be done.
    # @param agent [String] The agent profile the issue is dispatched to, from the ones the system
    #   prompt lists.
    # @param description [String, nil] What the work is.
    # @param blocked_by [Array<String>] The ids of every issue that must be done before this one.
    #   Defaults to none.
    # @param epic_id [String, nil] The id of an existing epic to group it under. Leave it out to
    #   leave it ungrouped and numbered under `ISSUE`.
    # @param reviewers [Array<String>] The agent profiles that must approve the work, from the same
    #   set. Required when this run's reviewers feature is on.
    # @return [GG::Board::IssueCreated] the id the board assigned, and the board budget
    # @raise [GG::Core::ApiError] `:invalid_argument` when `agent` or a reviewer is not one this run
    #   declares, and `:conflict` on a blocker edge that would close a cycle.
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
    operation :create_issue, "board.create_issue", tool: "create_issue"

    # Revise an issue; at least one field is required.
    #
    # @param id [String] The issue to revise.
    # @param title [String, nil] The title to replace the old one with. Leave it out to keep the one
    #   it has.
    # @param description [String, nil, GG::Core::Unchanged] The description to replace the old one
    #   with; `nil` clears it, and leaving it out keeps the one it has.
    # @param in_scope [String, nil] The scope statement to replace the old one with.
    # @param out_of_scope [String, nil] The non-scope statement to replace the old one with.
    # @param completion_criteria [String, nil] The completion criteria to replace the old ones with.
    # @param status [GG::Board::IssueStatus, nil] Where the issue now stands. Leave it out to keep
    #   the status it has.
    # @param epic_id [String, nil, GG::Core::Unchanged] The epic to regroup it under; `nil` detaches
    #   it from the one it has, and leaving it out keeps the grouping.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.update_issue(id, title: nil, description: Core::UNCHANGED, in_scope: nil,
                          out_of_scope: nil, completion_criteria: nil, status: nil,
                          epic_id: Core::UNCHANGED)
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
    operation :update_issue, "board.update_issue", tool: "update_issue"

    # Replace an issue's whole blocker set; passing no blockers clears every one of them.
    #
    # @param id [String] The issue whose blockers to replace.
    # @param blocked_by [Array<String>] The ids of every issue that must now be done before it,
    #   splatted. Passing none clears them all.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id, and `:conflict` when an edge
    #   would close a cycle.
    def self.set_issue_blocked_by(id, *blocked_by)
      Wire.call("set_issue_blocked_by", "board", "setIssueBlockedBy",
                [id, Check.strings("set_issue_blocked_by", "blocked_by", blocked_by)])
      nil
    end
    operation :set_issue_blocked_by, "board.set_issue_blocked_by", tool: "set_issue_blocked_by"

    # Remove an epic, keeping its issues and ungrouping them.
    #
    # @param id [String] The epic to remove.
    # @return [GG::Board::BoardUsage] how much of the board budget is still used
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.remove_epic(id)
      usage(Wire.call("remove_epic", "board", "removeEpic", [id]))
    end
    operation :remove_epic, "board.remove_epic", tool: "remove_epic"

    # Remove an issue and every blocker edge pointing at it.
    #
    # @param id [String] The issue to remove.
    # @return [GG::Board::BoardUsage] how much of the board budget is still used
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.remove_issue(id)
      usage(Wire.call("remove_issue", "board", "removeIssue", [id]))
    end
    operation :remove_issue, "board.remove_issue", tool: "remove_issue"

    # Register a wait on an issue and hand back an acknowledgement.
    #
    # It does not block inside the program: it records the wait and returns at once, so the rest
    # of the program still runs. The run suspends once the program ends, until the issue is
    # terminal — done, or failed — and resumes on the next turn.
    #
    # @param id [String] The issue to wait on. It may not be the issue this session was assigned to
    #   implement.
    # @return [String] the acknowledgement, which says what happens once the program ends
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.wait_for_issue(id)
      Wire.call("wait_for_issue", "board", "waitForIssue", [id])
    end
    operation :wait_for_issue, "board.wait_for_issue", tool: "wait_for_issue"

    # Where an issue stands.
    #
    # Every arm is a Symbol: `GG::Board::IssueStatus::DONE` and `:done` are the same value.
    module IssueStatus
      # Not started, and dispatchable once its blockers are done.
      OPEN = :open

      # Dispatched, with its assigned agent working on it.
      IN_PROGRESS = :in_progress

      # Finished and, where this run requires reviewers, approved.
      DONE = :done

      # Every status an issue may be moved to.
      ALL = [OPEN, IN_PROGRESS, DONE].freeze
    end

    # How much of the run's board budget is used, after the call that returned it.
    class BoardUsage
      include Value

      # @return [Integer] Epics currently on the board.
      attr_reader :epics

      # @return [Integer] The most epics this run allows.
      attr_reader :max_epics

      # @return [Integer] Issues currently on the board.
      attr_reader :issues

      # @return [Integer] The most issues this run allows.
      attr_reader :max_issues

      # @api private
      def initialize(epics:, max_epics:, issues:, max_issues:)
        @epics = epics
        @max_epics = max_epics
        @issues = issues
        @max_issues = max_issues
        freeze
      end
    end

    # An epic that was just created: the id its prefix resolved to, and the board budget.
    class EpicCreated
      include Value

      # The epic's id: the prefix given, upper-cased, so `auth` becomes `AUTH`.
      #
      # It is what groups issues under the epic, and the stem those issues are numbered from
      # (`AUTH-1`).
      #
      # @return [String]
      attr_reader :id

      # @return [GG::Board::BoardUsage] How much of the board budget is used.
      attr_reader :board

      # @api private
      def initialize(id:, board:)
        @id = id
        @board = board
        freeze
      end
    end

    # An issue that was just created: the id the board assigned it, and the board budget.
    class IssueCreated
      include Value
      extend Surface::Operations

      # The id the board assigned (`AUTH-1`), which is not the caller's to choose.
      #
      # It is what blocks a later issue on this one, and what waits for it.
      #
      # @return [String]
      attr_reader :id

      # @return [GG::Board::BoardUsage] How much of the board budget is used.
      attr_reader :board

      # @api private
      def initialize(id:, board:)
        @id = id
        @board = board
        freeze
      end

      # Register a wait on this issue, which suspends the session between turns until it is
      # terminal.
      #
      # The wait is recorded and the program runs on; the suspension happens once the program ends.
      #
      # @return [String] the acknowledgement, which says what happens once the program ends
      # @raise [GG::Core::ApiError] `:not_found` when the issue has since been removed.
      def wait
        Board.wait_for_issue(@id)
      end
      member_operation :wait, "board.wait_for_issue", tool: "wait_for_issue"
    end
  end
end
