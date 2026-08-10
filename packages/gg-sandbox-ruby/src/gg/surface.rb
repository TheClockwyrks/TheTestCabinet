# frozen_string_literal: true

module GG
  # The declaration a capability module writes under each of its model-facing methods, and the
  # registry those declarations build.
  #
  # Two readers need to know which of a module's methods are gg's and which gg operation each one
  # binds, and there is exactly one place either of them learns it: the `operation` line written
  # under the method's own `end`.
  #
  # 1. `GG::Scope`, which binds the subset of them this run offers onto the modules a program calls.
  # 2. `tools/signatures.rb`, which requires this SDK, reads {registry} and reflects each entry's
  #    YARD documentation into `crates/gg/src/sandbox/guests/ruby.signatures.json`.
  #
  # ## Why the declaration sits below the method rather than above it
  #
  # Because YARD attaches a doc comment to the statement that follows it, and a statement between
  # the comment and the `def` takes the documentation with it — the method then arrives at a model
  # with no description at all. So the declaration goes where Ruby already writes `private`,
  # `module_function` and `alias_method`: immediately after the `end` it is about, naming the method
  # it is about.
  #
  # ## Why an entry carries a gate at all
  #
  # The **catalogue** carries none: which capability buys an operation is gg's to state, once, in
  # its own operations table, and this reflector emits no gate field of any kind. What the *guest*
  # still needs is different — it builds the surface a program is handed out of the run's enabled
  # set, so it has to know which gg tool name buys which method. That is a run-time binding fact
  # rather than a documentation one, and it disappears from here entirely once the SDK becomes
  # static and the host refuses a withheld call outright.
  #
  # @api private
  module Surface
    # One model-facing declaration: what it is called, where it lives, which gg operation it binds,
    # and what this run must offer for it to be bound.
    #
    # @api private
    class Entry
      # @return [Module] the module or class the method is declared on
      attr_reader :owner

      # @return [Symbol] the method's own name
      attr_reader :name

      # @return [String] gg's operation id, `namespace.key`
      attr_reader :operation

      # @return [Boolean] whether this is a second way to reach {operation} rather than the first
      attr_reader :aliased

      # @return [String, nil] the gg tool that must be enabled, or nil when no tool gates it
      attr_reader :tool

      # @return [String, nil] the ending role whose programs bind it, or nil
      attr_reader :ending

      # @return [Boolean] whether the program library capability binds it
      attr_reader :library

      # @param owner [Module] the module or class the method is declared on
      # @param name [Symbol] the method's own name
      # @param operation [String] gg's operation id
      # @param aliased [Boolean] whether it is a second way to reach that operation
      # @param tool [String, nil] the gg tool that must be enabled
      # @param ending [String, nil] the ending role whose programs bind it
      # @param library [Boolean] whether the program library capability binds it
      def initialize(owner:, name:, operation:, aliased:, tool:, ending:, library:)
        @owner = owner
        @name = name
        @operation = operation
        @aliased = aliased
        @tool = tool
        @ending = ending
        @library = library
        freeze
      end

      # Whether this run offers the method, given what it enabled.
      #
      # @param enabled [Array<String>] the run's enabled gg tool names
      # @param ending [String] the ending role this program is given
      # @param library [Boolean] whether this agent keeps a program library
      # @return [Boolean] whether to bind it
      def offered?(enabled, ending, library)
        return library if @library
        return @ending == ending unless @ending.nil?
        return true if @tool.nil?

        enabled.include?(@tool)
      end

      # Whether the method is a module function rather than a member of a value.
      #
      # @return [Boolean] true for a module function
      def module_function?
        @owner.is_a?(Module) && !@owner.is_a?(Class)
      end

      # The fully-qualified name a documentation view of this method is opened by.
      #
      # A module function is reached through the module (`GG::Files.read_file`) and a member through
      # a value (`GG::Views::OpenView#close`), which is the separator Ruby and YARD both use for the
      # two.
      #
      # @return [String] the name
      def fqn
        "#{@owner.name}#{module_function? ? "." : "#"}#{@name}"
      end
    end

    # The capability modules the surface is divided into, **in the order a reader meets them**.
    #
    # It runs from the modules almost every run has to the ones a particular shape of agent has,
    # because a model reads a list from the top. `Core` is last and declares no function at all:
    # it holds the failure every call may raise and the summary every directory is made of.
    #
    # Constant names rather than the modules themselves, so this file stays pure data that the
    # reflector can require before anything that touches the membrane is loaded. Each module's gg
    # id is its name in lower case, and the reflector asserts that of every one of them.
    MODULES = %w[
      Files
      Shell
      Board
      Tasks
      Memories
      Views
      Context
      Delegation
      Skills
      Programs
      Session
      Core
    ].freeze

    # Every declaration made so far, in the order the source declares them.
    @registry = []

    class << self
      # @return [Array<Entry>] every model-facing declaration this SDK makes
      attr_reader :registry
    end

    # Record one declaration. Called by {Operations#operation} and {Operations#member_operation}.
    #
    # @param entry [Entry] the declaration
    # @return [Entry] the same declaration
    def self.declare(entry)
      @registry << entry
      entry
    end

    # Every entry declared on `owner`, in declaration order.
    #
    # @param owner [Module] the module or class to look under
    # @return [Array<Entry>] its declarations
    def self.declared_on(owner)
      @registry.select { |entry| entry.owner.equal?(owner) }
    end

    # The gg tool names this SDK really defines a method for.
    #
    # `GG::Scope.bound_tools` answers the component's `bound-tools` export with this, and gg
    # compares it against its own vocabulary on the **committed artifact** — the one drift check
    # that catches a stale `.wasm` rather than a stale source file.
    #
    # @return [Array<String>] every gg tool a canonical declaration binds, in declaration order
    def self.tools
      @registry.reject(&:aliased).filter_map(&:tool).uniq
    end

    # The declaration syntax a capability module extends itself with.
    #
    # @api private
    module Operations
      # Declare that the module function `name` binds the gg operation `id`.
      #
      # @param name [Symbol] the method this module declares
      # @param id [String] gg's operation id, `namespace.key`
      # @param tool [String, nil] the gg tool that must be enabled for a program to be given it
      # @param ending [String, nil] the ending role whose programs are given it
      # @param library [Boolean] whether the program library capability gives it
      # @return [Entry] the recorded declaration
      def operation(name, id, tool: nil, ending: nil, library: false)
        Surface.declare(Entry.new(owner: self, name: name, operation: id, aliased: false,
                                  tool: tool, ending: ending, library: library))
      end

      # Declare that the instance method `name` is a **second** way to reach the operation `id`.
      #
      # A member function is bound exactly when the module function it stands beside is, so it
      # carries the same gate and states it the same way.
      #
      # @param name [Symbol] the method this class declares
      # @param id [String] gg's operation id, `namespace.key`
      # @param tool [String, nil] the gg tool that must be enabled for a program to be given it
      # @param library [Boolean] whether the program library capability gives it
      # @return [Entry] the recorded declaration
      def member_operation(name, id, tool: nil, library: false)
        Surface.declare(Entry.new(owner: self, name: name, operation: id, aliased: true,
                                  tool: tool, ending: nil, library: library))
      end
    end
  end
end
