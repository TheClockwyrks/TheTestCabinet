# frozen_string_literal: true

module GG
  # The `tasks` family: the task DAG.
  #
  # Two lowerings live here, both so a model writes ordinary Ruby instead of a tagged union.
  # `description` on a patch is a three-way edit — leave it out to keep the description, pass `nil`
  # to clear it, pass a string to replace it — which the membrane models as a `text-edit` variant
  # and which `UNCHANGED` is the Ruby spelling of. And a status is a Symbol on this side and the
  # membrane's `in-progress` on the other, because WIT identifiers cannot contain an underscore; a
  # model should never see that seam.
  #
  # @api private
  module Tasks
    # The membrane's budget record, as the model-facing one.
    #
    # @param usage [Object] the wire record
    # @return [TaskUsage] the budget a program reads
    def self.usage(usage)
      TaskUsage.new(
        count: Wire.field(usage, "count"),
        max_tasks: Wire.field(usage, "maxTasks")
      )
    end

    # Add a task to the task DAG and return the task budget.
    #
    # @param id [String] The id you choose for it. It is what every other task call takes, and no
    #   two tasks may share one.
    # @param title [String] A short line naming the work.
    # @param description [String, nil] What the work is, at whatever length is useful.
    # @param blocked_by [Array<String>] The ids of the tasks that must be done before this one.
    #   Defaults to none.
    # @return [TaskUsage] how much of the task budget is now used
    # @raise [ToolError] `:conflict` on a duplicate id or on an edge that would close a cycle.
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

    # Revise a task's title, description and/or status; supply at least one.
    #
    # @param id [String] The task to revise.
    # @param title [String, nil] The title to replace the old one with. Leave it out to keep the
    #   one it has.
    # @param description [String, nil, Unchanged] The description to replace the old one with; `nil`
    #   clears it, and leaving it out (or passing `UNCHANGED`) keeps the one it has.
    # @param status [Symbol, nil] Where the task now stands — one of `TaskStatus`'s symbols. Leave
    #   it out to keep the status it has.
    # @return [nil] nothing; the revision either happened or raised
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.update_task(id, title: nil, description: UNCHANGED, status: nil)
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

    # Replace a task's whole blocker set; no arguments clears every blocker.
    #
    # @param id [String] The task whose blockers to replace.
    # @param blocked_by [Array<String>] The ids of every task that must now be done before it,
    #   splatted. Passing none clears them all.
    # @return [nil] nothing; the replacement either happened or raised
    # @raise [ToolError] `:not_found` for an unknown id, and `:conflict` when an edge would close a
    #   cycle.
    def self.set_blocked_by(id, *blocked_by)
      Wire.call("set_blocked_by", "tasks", "setBlockedBy",
                [id, Check.strings("set_blocked_by", "blocked_by", blocked_by)])
      nil
    end

    # Mark a task done.
    #
    # Tasks it was blocking become actionable once every one of their blockers is done.
    #
    # @param id [String] The task to mark done.
    # @return [nil] nothing; the task either moved or raised
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.complete_task(id)
      Wire.call("complete_task", "tasks", "completeTask", [id])
      nil
    end

    # Remove a task and every blocker edge pointing at it, and return the task budget.
    #
    # @param id [String] The task to remove.
    # @return [TaskUsage] how much of the task budget is still used
    # @raise [ToolError] `:not_found` for an unknown id.
    def self.remove_task(id)
      usage(Wire.call("remove_task", "tasks", "removeTask", [id]))
    end
  end
end
