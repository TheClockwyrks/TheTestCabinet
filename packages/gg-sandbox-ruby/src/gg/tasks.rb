# frozen_string_literal: true

module GG
  # A private task list, kept as a directed acyclic graph rather than as a list of lines.
  #
  # Every task may name the tasks that must finish before it, and an edge that would close a cycle
  # is refused.
  #
  # A description is a three-way edit: leaving the argument out, or passing `GG::Core::UNCHANGED`,
  # keeps it; `nil` clears it; a string replaces it.
  module Tasks
    extend Surface::Operations

    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [GG::Tasks::TaskUsage] the budget a program reads
    # @api private
    def self.usage(usage)
      TaskUsage.new(
        count: Wire.field(usage, "count"),
        max_tasks: Wire.field(usage, "maxTasks")
      )
    end
    private_class_method :usage

    # Add a task to the task list and hand back the task budget.
    #
    # @param id [String] The id this task takes. Every other task call takes it, and no two tasks
    #   may share one.
    # @param title [String] A short line naming the work.
    # @param description [String, nil] What the work is, at whatever length is useful.
    # @param blocked_by [Array<String>] The ids of the tasks that must be done before this one.
    #   Defaults to none.
    # @return [GG::Tasks::TaskUsage] how much of the task budget is now used
    # @raise [GG::Core::ApiError] `:conflict` on a duplicate id or on an edge that would close a
    #   cycle.
    def self.add_task(id, title, description: nil, blocked_by: [])
      usage(Wire.call("add_task", "tasks", "addTask", [
                        Wire.record(
                          "id" => id,
                          "title" => title,
                          "description" => description,
                          "blockedBy" => Check.strings("add_task", "blocked_by", blocked_by)
                        )
                      ]))
    end
    operation :add_task, "tasks.add_task", tool: "add_task"

    # Revise a task's title, description or status; at least one of them is required.
    #
    # @param id [String] The task to revise.
    # @param title [String, nil] The title to replace the old one with. Leave it out to keep the one
    #   it has.
    # @param description [String, nil, GG::Core::Unchanged] The description to replace the old one
    #   with; `nil` clears it, and leaving it out keeps the one it has.
    # @param status [GG::Tasks::TaskStatus, nil] Where the task now stands. Leave it out to keep the
    #   status it has.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.update_task(id, title: nil, description: Core::UNCHANGED, status: nil)
      Wire.call("update_task", "tasks", "updateTask", [
                  id,
                  Wire.record(
                    "title" => title,
                    "description" => Wire.text_edit(description),
                    "status" => Wire.arm(Check.choice("update_task", "status", status,
                                                      TaskStatus::ALL))
                  )
                ])
      nil
    end
    operation :update_task, "tasks.update_task", tool: "update_task"

    # Replace a task's whole blocker set; passing no blockers clears every one of them.
    #
    # @param id [String] The task whose blockers to replace.
    # @param blocked_by [Array<String>] The ids of every task that must now be done before it,
    #   splatted. Passing none clears them all.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id, and `:conflict` when an edge
    #   would close a cycle.
    def self.set_blocked_by(id, *blocked_by)
      Wire.call("set_blocked_by", "tasks", "setBlockedBy",
                [id, Check.strings("set_blocked_by", "blocked_by", blocked_by)])
      nil
    end
    operation :set_blocked_by, "tasks.set_blocked_by", tool: "set_blocked_by"

    # Mark a task done.
    #
    # Tasks it was blocking become actionable once every one of their blockers is done.
    #
    # @param id [String] The task to mark done.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.complete_task(id)
      Wire.call("complete_task", "tasks", "completeTask", [id])
      nil
    end
    operation :complete_task, "tasks.complete_task", tool: "complete_task"

    # Remove a task and every blocker edge pointing at it, and hand back the task budget.
    #
    # @param id [String] The task to remove.
    # @return [GG::Tasks::TaskUsage] how much of the task budget is still used
    # @raise [GG::Core::ApiError] `:not_found` for an unknown id.
    def self.remove_task(id)
      usage(Wire.call("remove_task", "tasks", "removeTask", [id]))
    end
    operation :remove_task, "tasks.remove_task", tool: "remove_task"

    # Where a task stands.
    #
    # Every arm is a Symbol: `GG::Tasks::TaskStatus::DONE` and `:done` are the same value.
    module TaskStatus
      # Not started. Every task begins here.
      PENDING = :pending

      # Being worked on now.
      IN_PROGRESS = :in_progress

      # Finished. Tasks blocked on it become actionable once all their blockers are done.
      DONE = :done

      # Every status a task may be moved to.
      ALL = [PENDING, IN_PROGRESS, DONE].freeze
    end

    # How much of the run's task budget is used, after the call that returned it.
    class TaskUsage
      include Value

      # @return [Integer] Tasks currently on the list.
      attr_reader :count

      # @return [Integer] The most tasks this run allows.
      attr_reader :max_tasks

      # @api private
      def initialize(count:, max_tasks:)
        @count = count
        @max_tasks = max_tasks
        freeze
      end
    end
  end
end
