# frozen_string_literal: true

# Ruby front-end of the twin diff: Prism → the normalized IR, one JSON document
# per file, written to stdout as an array. The Builder is the trails codegen
# spike's (blazetrailsdev/trails, branch spike-ar-ruby-ir-ts-29583a,
# scripts/codegen/ruby/build-ir.rb), copied with macro and loop expansion off:
# the diff compares what the Ruby says, not what it expands to.
#
# Usage: ruby scripts/twin-diff/ruby-ir.rb <root> file.rb ...


# Prism 1.0 is where ConstantPathNode#name and the node API this builder
# reads arrived; Ruby 3.3 ships 0.19, so say so rather than crash mid-file.
gem "prism", ">= 1.0"
require "prism"
require "json"
require "fileutils"

module CodegenIR
  class UnhandledNode < StandardError; end

  class Builder
    attr_reader :unhandled_counts

    def initialize(source, env = nil)
      @source = source
      @unhandled_counts = Hash.new(0)
      @env = env
      # :body while directly in a class/module body (or a class-level block), :def inside a method
      @ctx = [[:top, ""]]
      @expansions = Hash.new(0)
    end

    attr_reader :expansions

    def source_text = @source.source

    def in_body? = @ctx.last[0] == :body
    def cur_fqn = @ctx.last[1]

    def with_ctx(kind, fqn)
      @ctx.push([kind, fqn])
      yield
    ensure
      @ctx.pop
    end

    def qualify_path(path)
      return path[1..].join("::") if path[0] == ""
      cur = @ctx.reverse.find { |k, f| k == :body && !f.empty? }&.last
      cur.nil? || cur.empty? ? path.join("::") : "#{cur}::#{path.join('::')}"
    end

    def line(node) = node.location.start_line

    def src(node)
      node.slice
    end

    def build_program(node)
      { k: "seq", body: stmts(node.statements) }
    end

    def stmts(node)
      return [] if node.nil?
      if node.is_a?(Prism::StatementsNode)
        return node.body.flat_map do |n|
          (in_body? && @env && (x = MacroExpander.new(self, @env, cur_fqn).expand(n))) ? x : [expr(n)]
        end
      end
      return stmts(node.statements) if node.is_a?(Prism::BeginNode) && node.rescue_clause.nil? && node.ensure_clause.nil? && node.else_clause.nil?
      [expr(node)]
    end

    def seq(node)
      body = stmts(node)
      { k: "seq", body: body }
    end

    def const_path(node)
      case node
      when Prism::ConstantReadNode then [node.name.to_s]
      when Prism::ConstantPathNode
        return nil unless node.parent.nil? || node.parent.is_a?(Prism::ConstantReadNode) || node.parent.is_a?(Prism::ConstantPathNode)
        parent = node.parent ? const_path(node.parent) : [""]
        parent && parent + [node.name.to_s]
      end
    end

    def params(node)
      return [] if node.nil?
      node = node.parameters if node.is_a?(Prism::BlockParametersNode)
      return [] if node.nil?
      if node.is_a?(Prism::NumberedParametersNode)
        return (1..node.maximum).map { |i| { kind: "req", name: "_#{i}" } }
      end
      return [{ kind: "req", name: "it" }] if node.class.name.end_with?("ItParametersNode")
      out = []
      node.requireds.each { |p| out << req_param(p) }
      node.optionals.each { |p| out << { kind: "opt", name: p.name.to_s, default: expr(p.value) } }
      if node.rest
        if node.rest.is_a?(Prism::ImplicitRestNode)
          # |a,| destructuring: ignore
        else
          out << { kind: "rest", name: node.rest.name&.to_s }
        end
      end
      node.posts.each { |p| out << req_param(p) }
      node.keywords.each do |p|
        if p.is_a?(Prism::RequiredKeywordParameterNode)
          out << { kind: "keyreq", name: p.name.to_s }
        else
          out << { kind: "key", name: p.name.to_s, default: expr(p.value) }
        end
      end
      if node.keyword_rest
        if node.keyword_rest.is_a?(Prism::ForwardingParameterNode)
          out << { kind: "fwd" }
        elsif node.keyword_rest.is_a?(Prism::NoKeywordsParameterNode)
          # **nil
        else
          out << { kind: "keyrest", name: node.keyword_rest.name&.to_s }
        end
      end
      out << { kind: "block", name: node.block.name&.to_s } if node.block
      out
    end

    def req_param(p)
      if p.is_a?(Prism::MultiTargetNode)
        { kind: "req", name: nil, destructure: (p.lefts + p.rights).map { |t| t.respond_to?(:name) ? t.name.to_s : nil } }
      else
        { kind: "req", name: p.name.to_s }
      end
    end

    def args(node)
      return [] if node.nil?
      node.arguments.flat_map do |a|
        case a
        when Prism::SplatNode
          if in_body? && @env && a.expression && (folded = fold_const_array(a.expression))
            next folded
          end
          { k: "splat", value: a.expression ? expr(a.expression) : { k: "fwdrest" } }
        when Prism::KeywordHashNode then { k: "kwargs", pairs: hash_pairs(a.elements) }
        when Prism::ForwardingArgumentsNode then { k: "fwdargs" }
        else expr(a)
        end
      end
    end

    def hash_pairs(elements)
      elements.map do |e|
        case e
        when Prism::AssocNode
          { key: expr(e.key), value: e.value.is_a?(Prism::ImplicitNode) ? expr(e.value.value) : expr(e.value) }
        when Prism::AssocSplatNode
          { splat: e.value ? expr(e.value) : { k: "fwdkwrest" } }
        else
          { splat: expr(e) }
        end
      end
    end

    def block(node)
      case node
      when nil then nil
      when Prism::BlockArgumentNode
        if node.expression.nil?
          { k: "blockpass", value: { k: "fwdblock" } }
        elsif node.expression.is_a?(Prism::SymbolNode)
          { k: "symproc", name: node.expression.unescaped }
        else
          { k: "blockpass", value: expr(node.expression) }
        end
      when Prism::BlockNode
        { k: "block", params: params(node.parameters), body: seq(node.body), l: line(node) }
      end
    end

    def call(node)
      recv = node.receiver ? expr(node.receiver) : nil
      name = node.name.to_s
      a = args(node.arguments)
      b = block(node.block)
      # `foo.bar = 1` is a CallNode with name `bar=`
      { k: "call", recv: recv, name: name, args: a, block: b, safe: node.safe_navigation?, l: line(node),
        vcall: node.receiver.nil? && node.arguments.nil? && node.block.nil? && node.variable_call? }
    end

    def lvalue_of(node)
      case node
      when Prism::LocalVariableOperatorWriteNode, Prism::LocalVariableOrWriteNode, Prism::LocalVariableAndWriteNode
        { k: "lvar", name: node.name.to_s }
      when Prism::InstanceVariableOperatorWriteNode, Prism::InstanceVariableOrWriteNode, Prism::InstanceVariableAndWriteNode
        { k: "ivar", name: node.name.to_s }
      when Prism::ClassVariableOrWriteNode, Prism::ClassVariableOperatorWriteNode, Prism::ClassVariableAndWriteNode
        { k: "cvar", name: node.name.to_s }
      when Prism::GlobalVariableOrWriteNode, Prism::GlobalVariableOperatorWriteNode, Prism::GlobalVariableAndWriteNode
        { k: "gvar", name: node.name.to_s }
      when Prism::ConstantOrWriteNode
        { k: "const", path: [node.name.to_s] }
      when Prism::CallOperatorWriteNode, Prism::CallOrWriteNode, Prism::CallAndWriteNode
        { k: "call", recv: node.receiver ? expr(node.receiver) : { k: "self" }, name: node.read_name.to_s, args: [], block: nil, safe: node.safe_navigation?, l: line(node) }
      when Prism::IndexOperatorWriteNode, Prism::IndexOrWriteNode, Prism::IndexAndWriteNode
        { k: "call", recv: expr(node.receiver), name: "[]", args: args(node.arguments), block: nil, safe: false, l: line(node) }
      end
    end

    def target(node)
      case node
      when Prism::LocalVariableTargetNode then { k: "lvar", name: node.name.to_s }
      when Prism::InstanceVariableTargetNode then { k: "ivar", name: node.name.to_s }
      when Prism::ClassVariableTargetNode then { k: "cvar", name: node.name.to_s }
      when Prism::GlobalVariableTargetNode then { k: "gvar", name: node.name.to_s }
      when Prism::ConstantTargetNode then { k: "const", path: [node.name.to_s] }
      when Prism::SplatNode then { k: "splat", value: node.expression ? target(node.expression) : nil }
      when Prism::MultiTargetNode then { k: "mtarget", targets: (node.lefts + [node.rest].compact + node.rights).map { |t| target(t) } }
      when Prism::CallTargetNode then { k: "call", recv: expr(node.receiver), name: node.name.to_s.chomp("="), args: [], block: nil, safe: node.safe_navigation?, l: line(node) }
      when Prism::IndexTargetNode then { k: "call", recv: expr(node.receiver), name: "[]", args: args(node.arguments), block: nil, safe: false, l: line(node) }
      when Prism::ImplicitRestNode then { k: "splat", value: nil }
      else unhandled(node)
      end
    end

    def unhandled(node)
      @unhandled_counts[node.class.name.split("::").last] += 1
      { k: "unhandled", node: node.class.name.split("::").last, src: src(node)[0, 200], l: line(node) }
    end

    def str_parts(parts)
      parts.map do |p|
        case p
        when Prism::StringNode then { k: "str", value: p.unescaped }
        when Prism::EmbeddedStatementsNode
          body = stmts(p.statements)
          body.size == 1 ? body[0] : { k: "seq", body: body }
        when Prism::EmbeddedVariableNode then expr(p.variable)
        else expr(p)
        end
      end
    end

    def expr(node)
      case node
      when nil then { k: "nil" }
      when Prism::StatementsNode then { k: "seq", body: stmts(node) }
      when Prism::ParenthesesNode
        b = stmts(node.body)
        b.size == 1 ? b[0] : { k: "seq", body: b }
      when Prism::NilNode then { k: "nil" }
      when Prism::TrueNode then { k: "true" }
      when Prism::FalseNode then { k: "false" }
      when Prism::SelfNode then { k: "self" }
      when Prism::IntegerNode then { k: "int", value: node.value.to_s }
      when Prism::FloatNode then { k: "float", value: node.value }
      when Prism::RationalNode then { k: "rational", num: node.numerator.to_s, den: node.denominator.to_s }
      when Prism::ImaginaryNode then unhandled(node)
      when Prism::StringNode, Prism::XStringNode then { k: "str", value: node.unescaped, frozen: node.frozen?, heredoc: node.heredoc? }
      when Prism::InterpolatedStringNode then { k: "dstr", parts: str_parts(node.parts) }
      when Prism::InterpolatedXStringNode then { k: "dstr", parts: str_parts(node.parts) }
      when Prism::SymbolNode then { k: "sym", value: node.unescaped }
      when Prism::InterpolatedSymbolNode then { k: "dsym", parts: str_parts(node.parts) }
      when Prism::RegularExpressionNode then { k: "regex", source: node.unescaped, flags: regex_flags(node) }
      when Prism::InterpolatedRegularExpressionNode then { k: "dregex", parts: str_parts(node.parts), flags: regex_flags(node) }
      when Prism::ArrayNode then { k: "array", elems: node.elements.map { |e| e.is_a?(Prism::SplatNode) ? { k: "splat", value: expr(e.expression) } : (e.is_a?(Prism::KeywordHashNode) ? { k: "hash", pairs: hash_pairs(e.elements) } : expr(e)) } }
      when Prism::HashNode, Prism::KeywordHashNode then { k: "hash", pairs: hash_pairs(node.elements) }
      when Prism::RangeNode then { k: "range", from: node.left && expr(node.left), to: node.right && expr(node.right), exclusive: node.exclude_end? }
      when Prism::SourceFileNode then { k: "str", value: "__FILE__" }
      when Prism::SourceLineNode then { k: "int", value: line(node).to_s }
      when Prism::SourceEncodingNode then { k: "str", value: "UTF-8" }

      when Prism::LocalVariableReadNode then { k: "lvar", name: node.name.to_s }
      when Prism::LocalVariableWriteNode then { k: "lasgn", name: node.name.to_s, value: expr(node.value), l: line(node) }
      when Prism::InstanceVariableReadNode then { k: "ivar", name: node.name.to_s }
      when Prism::InstanceVariableWriteNode then { k: "iasgn", name: node.name.to_s, value: expr(node.value), l: line(node) }
      when Prism::ClassVariableReadNode then { k: "cvar", name: node.name.to_s }
      when Prism::ClassVariableWriteNode then { k: "cvasgn", name: node.name.to_s, value: expr(node.value) }
      when Prism::GlobalVariableReadNode then { k: "gvar", name: node.name.to_s }
      when Prism::GlobalVariableWriteNode then { k: "gasgn", name: node.name.to_s, value: expr(node.value) }
      when Prism::BackReferenceReadNode then { k: "gvar", name: node.slice }
      when Prism::NumberedReferenceReadNode then { k: "nthref", n: node.number }
      when Prism::ConstantReadNode then { k: "const", path: [node.name.to_s] }
      when Prism::ConstantPathNode
        path = const_path(node)
        path ? { k: "const", path: path } : { k: "constscope", scope: expr(node.parent), name: node.name.to_s }
      when Prism::ConstantWriteNode
        class_like_const([node.name.to_s], node) || { k: "casgn", path: [node.name.to_s], value: expr(node.value), l: line(node) }
      when Prism::ConstantPathWriteNode then { k: "casgn", path: const_path(node.target), value: expr(node.value), l: line(node) }

      when Prism::LocalVariableOrWriteNode, Prism::InstanceVariableOrWriteNode, Prism::ClassVariableOrWriteNode,
           Prism::GlobalVariableOrWriteNode, Prism::ConstantOrWriteNode, Prism::CallOrWriteNode, Prism::IndexOrWriteNode
        { k: "opasgn", op: "||", target: lvalue_of(node), value: expr(node.value), l: line(node) }
      when Prism::LocalVariableAndWriteNode, Prism::InstanceVariableAndWriteNode, Prism::CallAndWriteNode, Prism::IndexAndWriteNode
        { k: "opasgn", op: "&&", target: lvalue_of(node), value: expr(node.value), l: line(node) }
      when Prism::LocalVariableOperatorWriteNode, Prism::InstanceVariableOperatorWriteNode, Prism::CallOperatorWriteNode,
           Prism::IndexOperatorWriteNode, Prism::ClassVariableOperatorWriteNode, Prism::GlobalVariableOperatorWriteNode
        { k: "opasgn", op: node.binary_operator.to_s, target: lvalue_of(node), value: expr(node.value), l: line(node) }
      when Prism::MultiWriteNode
        { k: "masgn", targets: (node.lefts + [node.rest].compact + node.rights).map { |t| target(t) }, value: expr(node.value), l: line(node) }
      when Prism::MatchWriteNode then expr(node.call)

      when Prism::CallNode then call(node)
      when Prism::SuperNode then { k: "super", args: args(node.arguments), block: block(node.block), zsuper: false, l: line(node) }
      when Prism::ForwardingSuperNode then { k: "super", args: nil, block: block(node.block), zsuper: true, l: line(node) }
      when Prism::YieldNode then { k: "yield", args: args(node.arguments), l: line(node) }
      when Prism::LambdaNode then { k: "lambda", params: params(node.parameters), body: seq(node.body), l: line(node) }
      when Prism::BlockArgumentNode then block(node)

      when Prism::AndNode then { k: "and", left: expr(node.left), right: expr(node.right) }
      when Prism::OrNode then { k: "or", left: expr(node.left), right: expr(node.right) }
      when Prism::DefinedNode then { k: "defined", value: expr(node.value), src: src(node) }
      when Prism::IfNode
        { k: "if", cond: expr(node.predicate), then: seq(node.statements), else: else_of(node.subsequent), l: line(node) }
      when Prism::UnlessNode
        { k: "if", cond: { k: "not", value: expr(node.predicate) }, then: seq(node.statements), else: node.else_clause ? seq(node.else_clause.statements) : nil, l: line(node) }
      when Prism::ElseNode then seq(node.statements)
      when Prism::WhileNode then { k: "while", cond: expr(node.predicate), body: seq(node.statements), do_while: node.begin_modifier?, l: line(node) }
      when Prism::UntilNode then { k: "while", cond: { k: "not", value: expr(node.predicate) }, body: seq(node.statements), do_while: node.begin_modifier?, l: line(node) }
      when Prism::ForNode then { k: "for", var: target(node.index), iter: expr(node.collection), body: seq(node.statements), l: line(node) }
      when Prism::CaseNode
        { k: "case", subject: node.predicate && expr(node.predicate),
          whens: node.conditions.map { |w| { conds: w.conditions.map { |c| c.is_a?(Prism::SplatNode) ? { k: "splat", value: expr(c.expression) } : expr(c) }, body: seq(w.statements) } },
          else: node.else_clause ? seq(node.else_clause.statements) : nil, l: line(node) }
      when Prism::CaseMatchNode then unhandled(node)
      when Prism::ReturnNode then { k: "return", value: ret_value(node.arguments), l: line(node) }
      when Prism::NextNode then { k: "next", value: ret_value(node.arguments), l: line(node) }
      when Prism::BreakNode then { k: "break", value: ret_value(node.arguments), l: line(node) }
      when Prism::RetryNode then { k: "retry", l: line(node) }
      when Prism::RedoNode then unhandled(node)
      when Prism::BeginNode then begin_node(node)
      when Prism::RescueModifierNode
        { k: "begin", body: { k: "seq", body: [expr(node.expression)] }, rescues: [{ classes: [], var: nil, body: { k: "seq", body: [expr(node.rescue_expression)] } }], else: nil, ensure: nil, l: line(node) }
      when Prism::FlipFlopNode then unhandled(node)

      when Prism::ModuleNode
        path = const_path(node.constant_path)
        body = with_ctx(:body, path ? qualify_path(path) : cur_fqn) { seq(node.body) }
        { k: "module", path: path, body: body, l: line(node) }
      when Prism::ClassNode
        path = const_path(node.constant_path)
        sup = node.superclass
        struct = struct_new?(sup) ? struct_members(sup) : nil
        superclass = struct ? nil : (sup && expr(sup))
        body = with_ctx(:body, path ? qualify_path(path) : cur_fqn) { seq(node.body) }
        { k: "class", path: path, superclass: superclass, struct: struct, body: body, l: line(node) }
      when Prism::SingletonClassNode
        { k: "sclass", target: expr(node.expression), body: seq(node.body), l: line(node) }
      when Prism::DefNode
        body = with_ctx(:def, cur_fqn) { node.body.is_a?(Prism::BeginNode) ? { k: "seq", body: [begin_node(node.body)] } : seq(node.body) }
        { k: "def", name: node.name.to_s, singleton: !node.receiver.nil?, receiver: node.receiver && expr(node.receiver),
          params: with_ctx(:def, cur_fqn) { params(node.parameters) }, body: body,
          l: line(node), lend: node.location.end_line, endless: node.equal_loc != nil }
      when Prism::AliasMethodNode then { k: "alias", new: node.new_name.respond_to?(:unescaped) ? node.new_name.unescaped : src(node.new_name), old: node.old_name.respond_to?(:unescaped) ? node.old_name.unescaped : src(node.old_name), l: line(node) }
      when Prism::AliasGlobalVariableNode then unhandled(node)
      when Prism::UndefNode then { k: "undef", names: node.names.map { |n| n.respond_to?(:unescaped) ? n.unescaped : src(n) } }
      when Prism::SplatNode then { k: "splat", value: node.expression ? expr(node.expression) : { k: "fwdrest" } }
      when Prism::ImplicitNode then expr(node.value)
      when Prism::PreExecutionNode, Prism::PostExecutionNode then unhandled(node)
      else unhandled(node)
      end
    end

    # `*CONST` in a class-body macro call, where CONST evaluates to an array of
    # literals → the literal elements (`delegate(*QUERYING_METHODS, to: :all)`).
    def fold_const_array(node)
      return nil unless node.is_a?(Prism::ConstantReadNode) || node.is_a?(Prism::ConstantPathNode)
      v = @env.evaluate(node.slice, cur_fqn)
      return nil unless v.is_a?(Array) && v.all? { |x| x.is_a?(Symbol) || x.is_a?(String) }
      v.map { |x| x.is_a?(Symbol) ? { k: "sym", value: x.to_s } : { k: "str", value: x } }
    rescue Exception # rubocop:disable Lint/RescueException
      nil
    end

    def struct_new?(n)
      n.is_a?(Prism::CallNode) && n.name == :new && n.receiver.is_a?(Prism::ConstantReadNode) && n.receiver.name == :Struct
    end

    def struct_members(call)
      args = call.arguments&.arguments || []
      members = args.select { |a| a.is_a?(Prism::SymbolNode) }.map(&:unescaped)
      kw = args.find { |a| a.is_a?(Prism::KeywordHashNode) }
      keyword_init = kw&.elements&.any? { |e| e.respond_to?(:key) && e.key.is_a?(Prism::SymbolNode) && e.key.unescaped == "keyword_init" && e.value.is_a?(Prism::TrueNode) }
      { members: members, keyword_init: !!keyword_init }
    end

    # `X = Struct.new(:a) do ... end` / `X = Class.new(Base) do ... end` → class IR.
    def class_like_const(path, node)
      v = node.value
      return nil unless v.is_a?(Prism::CallNode) && v.name == :new && v.receiver.is_a?(Prism::ConstantReadNode)
      return nil unless %i[Struct Class].include?(v.receiver.name)
      return nil if v.receiver.name == :Class && v.block.nil? && v.arguments.nil?
      fqn = qualify_path(path)
      body = v.block.is_a?(Prism::BlockNode) ? with_ctx(:body, fqn) { seq(v.block.body) } : { k: "seq", body: [] }
      if v.receiver.name == :Struct
        { k: "class", path: path, superclass: nil, struct: struct_members(v), body: body, l: line(node) }
      else
        sup = v.arguments&.arguments&.first
        { k: "class", path: path, superclass: sup && expr(sup), body: body, l: line(node) }
      end
    end

    def regex_flags(node)
      f = +""
      f << "i" if node.ignore_case?
      f << "m" if node.multi_line?
      f << "x" if node.extended?
      f
    end

    def ret_value(arguments)
      return nil if arguments.nil?
      a = args(arguments)
      a.size == 1 && a[0][:k] != "splat" ? a[0] : { k: "array", elems: a }
    end

    def else_of(node)
      case node
      when nil then nil
      when Prism::ElseNode then seq(node.statements)
      when Prism::IfNode then { k: "seq", body: [expr(node)] }
      end
    end

    def begin_node(node)
      rescues = []
      r = node.rescue_clause
      while r
        rescues << { classes: r.exceptions.map { |e| e.is_a?(Prism::SplatNode) ? { k: "splat", value: expr(e.expression) } : expr(e) }, var: r.reference && target(r.reference), body: seq(r.statements) }
        r = r.subsequent
      end
      { k: "begin", body: seq(node.statements), rescues: rescues, else: node.else_clause && seq(node.else_clause.statements),
        ensure: node.ensure_clause && seq(node.ensure_clause.statements), l: line(node) }
    end
  end
end

module CodegenIR
  MISSING = Object.new.freeze

  # Gem-wide constant table evaluated lazily in a sandbox: every constant the gem
  # assigns at class/module level, keyed by fqn, with its source text.
  class ConstEnv
    attr_reader :namespaces

    def initialize
      @table = {}
      @namespaces = Set.new
      @cache = {}
      @proxies = {}
    end

    attr_reader :macros

    # Every `def` at class/module-body level, kept as source so a class-body
    # call to it (a gem-defined macro such as `define_column_methods`) can be
    # executed against a Recorder.
    def collect_macros(program, file, source)
      @macros ||= Hash.new { |h, k| h[k] = [] }
      @macro_mods ||= {}
      walk = lambda do |node, nesting|
        case node
        when Prism::ModuleNode, Prism::ClassNode
          path = path_of(node.constant_path)
          return unless path
          fqn = path.start_with?("::") ? path[2..] : [nesting, path].reject(&:empty?).join("::")
          node.body.is_a?(Prism::StatementsNode) && node.body.body.each { |c| walk.(c, fqn) }
        when Prism::StatementsNode then node.body.each { |c| walk.(c, nesting) }
        when Prism::ProgramNode then walk.(node.statements, nesting)
        when Prism::SingletonClassNode
          node.body.is_a?(Prism::StatementsNode) && node.body.body.each { |c| walk.(c, nesting) }
        when Prism::CallNode
          if node.receiver.nil? && %i[private protected public].include?(node.name)
            node.arguments&.arguments&.each { |a| walk.(a, nesting) }
          elsif node.block.is_a?(Prism::BlockNode) && node.block.body.is_a?(Prism::StatementsNode)
            sub = node.name == :class_methods ? "#{nesting}::ClassMethods" : nesting
            node.block.body.body.each { |c| walk.(c, sub) }
          end
        when Prism::DefNode
          text = source[node.location.start_offset...node.location.end_offset]
          entry = { name: node.name.to_s, text: text, nesting: nesting, file: file, line: node.location.start_line }
          @macros[node.name.to_s] << entry
          (@macro_by_nesting ||= Hash.new { |h, k| h[k] = [] })[nesting] << entry
        end
      end
      walk.(program, "")
    end

    # A module holding every def of one class/module body, with constants
    # resolved through the sandbox.
    def macro_module(nesting)
      @macro_mods ||= {}
      @macro_mods[nesting] ||= begin
        env = self
        m = Module.new
        m.define_singleton_method(:const_missing) { |n| env.lookup(n.to_s, nesting) }
        (@macro_by_nesting || {})[nesting]&.each do |e|
          next if e[:text].match?(UNSAFE)
          begin
            m.module_eval(e[:text], e[:file], e[:line])
          rescue Exception # rubocop:disable Lint/RescueException
            nil
          end
        end
        m.send(:public, *m.private_instance_methods(false)) unless m.private_instance_methods(false).empty?
        m
      end
    end

    def collect(program)
      walk = lambda do |node, nesting|
        case node
        when Prism::ModuleNode, Prism::ClassNode
          path = path_of(node.constant_path)
          return unless path
          fqn = path.start_with?("::") ? path[2..] : [nesting, path].reject(&:empty?).join("::")
          @namespaces << fqn
          node.body&.compact_child_nodes&.each { |c| walk.(c, fqn) } if node.body
          node.body.is_a?(Prism::StatementsNode) && node.body.body.each { |c| walk.(c, fqn) }
        when Prism::ConstantWriteNode
          @table[[nesting, node.name.to_s].reject(&:empty?).join("::")] = [node.value.slice, nesting]
        when Prism::StatementsNode
          node.body.each { |c| walk.(c, nesting) }
        when Prism::ProgramNode
          walk.(node.statements, nesting)
        when Prism::CallNode
          # included do / class_methods do bodies
          node.block.is_a?(Prism::BlockNode) && node.block.body.is_a?(Prism::StatementsNode) && node.block.body.body.each { |c| walk.(c, nesting) }
        end
      end
      walk.(program, "")
    end

    def path_of(n)
      case n
      when Prism::ConstantReadNode then n.name.to_s
      when Prism::ConstantPathNode
        return "::#{n.name}" if n.parent.nil?
        p = path_of(n.parent)
        p && "#{p}::#{n.name}"
      end
    end

    def proxy(fqn)
      @proxies[fqn] ||= begin
        env = self
        m = Module.new
        m.define_singleton_method(:const_missing) { |n| env.lookup(n.to_s, fqn) }
        m.define_singleton_method(:inspect) { fqn }
        m.define_singleton_method(:to_s) { fqn }
        m
      end
    end

    def lookup(name, nesting_fqn)
      parts = nesting_fqn.split("::")
      parts.length.downto(0) do |i|
        f = (parts[0, i] + [name]).join("::")
        v = value_of(f)
        return v unless v.equal?(MISSING)
      end
      raise NameError, "uninitialized constant #{name}"
    end

    def value_of(fqn)
      return @cache[fqn] if @cache.key?(fqn)
      if (e = @table[fqn])
        @cache[fqn] = MISSING
        @cache[fqn] = begin
          evaluate(e[0], e[1])
        rescue Exception # rubocop:disable Lint/RescueException
          MISSING
        end
      elsif @namespaces.include?(fqn)
        proxy(fqn)
      else
        MISSING
      end
    end

    UNSAFE = /`|\bsystem\b|\bexec\b|\bFile\.|\bIO\.|\bDir\.|\bENV\b|\brequire\b|\bload\b|\beval\b/

    def evaluate(src, nesting_fqn)
      raise ArgumentError, "unsafe" if src.match?(UNSAFE)
      proxy(nesting_fqn).module_eval(src)
    end
  end

  # Records the calls a class-body loop makes on `self`.
  class Recorder < BasicObject
    def initialize(log) = (@log = log)

    def method_missing(name, *args, **kw, &blk)
      @log << [name, args, kw, blk]
      nil
    end

    def respond_to_missing?(*) = true
  end

  # Runs a gem-defined macro: `self` is a recorder that has the macro's own
  # body module mixed in (so private helpers it calls run too), Kernel's
  # conversions, and records everything else it is asked to do.
  class MacroRecorder
    def initialize(log) = (@log = log)

    def method_missing(name, *args, **kw, &blk)
      @log << [name, args, kw, blk]
      nil
    end

    def respond_to_missing?(*) = true

    %i[define_method define_singleton_method module_eval class_eval class_exec instance_eval alias_method
       attr_accessor attr_reader attr_writer private protected public delegate include extend].each do |m|
      define_method(m) { |*args, **kw, &blk| @log << [m, args, kw, blk]; nil }
    end
  end

  # Unrolls `CONST.each do |x| ... end` (and each_with_index / each_pair) at
  # class-body level by running the block in Ruby against a Recorder, then turns
  # each recorded call back into IR: `class_eval <<-CODE` strings are re-parsed
  # with Prism, `define_method(name) { ... }` becomes a def, other macros
  # (`delegate`, `alias_method`, `attr_*`, ...) become calls with literal args.
  class MacroExpander
    LOOPS = %i[each each_with_index each_pair each_key each_value].freeze

    def initialize(builder, env, fqn)
      @b = builder
      @env = env
      @fqn = fqn
    end

    def expand(node)
      return expand_macro_call(node) if node.is_a?(Prism::CallNode) && node.receiver.nil? && node.block.nil? && @env.macros&.key?(node.name.to_s)
      return nil unless node.is_a?(Prism::CallNode) && LOOPS.include?(node.name) && node.receiver && node.block.is_a?(Prism::BlockNode)
      coll = begin
        @env.evaluate(node.receiver.slice, @fqn)
      rescue Exception # rubocop:disable Lint/RescueException
        return nil
      end
      return nil unless coll.is_a?(Array) || coll.is_a?(Hash) || coll.is_a?(Set)
      blk = node.block
      pnames = block_param_names(blk)
      return nil unless pnames
      text = @b.source_text[blk.opening_loc.end_offset...blk.closing_loc.start_offset]
      text = text.sub(/\A\s*\|[^|]*\|/, "")
      src = "->(#{pnames.join(', ')}) {\n#{text}\n}"
      lam = @env.proxy(@fqn).module_eval(src)
      out = []
      items = node.name == :each_with_index ? coll.each_with_index.to_a : coll.to_a
      items.each do |item|
        log = []
        args = pnames.size > 1 && item.is_a?(Array) ? item : [item]
        args = args.first(pnames.size) + [nil] * [pnames.size - args.size, 0].max
        Recorder.new(log).instance_exec(*args, &lam)
        log.each { |rec| out.concat(to_ir(rec, blk, pnames, args)) }
      end
      @b.expansions[node.receiver.slice] += 1
      out
    rescue Exception => e # rubocop:disable Lint/RescueException
      $expansion_failures << "#{@fqn} #{node.receiver.slice[0, 60]}: #{e.class}: #{e.message[0, 120]}"
      nil
    end

    MACRO_ALLOW = /\Adefine_|_methods?\z|\Aattribute_method_/

    def expand_macro_call(node)
      name = node.name.to_s
      return nil unless name.match?(MACRO_ALLOW)
      cands = @env.macros[name]
      entry = cands.max_by { |e| common_prefix(e[:nesting], @fqn) }
      return nil unless entry
      args = node.arguments ? @env.evaluate("[#{node.arguments.slice}]", @fqn) : []
      return nil unless args.is_a?(Array)
      log = []
      rec = MacroRecorder.new(log)
      rec.singleton_class.include(@env.macro_module(entry[:nesting]))
      rec.__send__(name, *args)
      out = []
      log.each { |r| out.concat(to_ir(r, nil, [], [])) }
      @b.expansions["#{name}(...)"] += 1
      out
    rescue Exception => e # rubocop:disable Lint/RescueException
      $expansion_failures << "#{@fqn} #{name}: #{e.class}: #{e.message[0, 160]}"
      nil
    end

    def common_prefix(a, b)
      a.split("::").zip(b.split("::")).take_while { |x, y| x == y }.size
    end

    # The Prism block a recorded Proc came from, located by its source_location.
    def block_ast(blk)
      file, line = blk.source_location
      return nil unless file && File.exist?(file)
      @@parsed ||= {}
      res = (@@parsed[file] ||= Prism.parse_file(file))
      q = [res.value]
      while (n = q.shift)
        return [n.block, res] if n.is_a?(Prism::CallNode) && n.block.is_a?(Prism::BlockNode) && n.block.location.start_line == line
        q.concat(n.compact_child_nodes)
      end
      nil
    end

    def block_param_names(blk)
      ps = blk.parameters&.parameters
      return [] if ps.nil?
      names = ps.requireds.map { |r| r.respond_to?(:name) ? r.name.to_s : nil }
      names.all? ? names : nil
    end

    def to_ir((name, args, kw, _blk), blk_node, pnames, vals) # rubocop:disable Metrics
      case name
      when :class_eval, :module_eval, :class_exec
        str = args.first
        return [] unless str.is_a?(String)
        prog = Prism.parse(str).value
        @b.stmts(prog.statements)
      when :define_method, :define_singleton_method
        if _blk && (found = block_ast(_blk))
          bnode, res = found
          bind = _blk.binding.local_variables.to_h { |v| [v.to_s, _blk.binding.local_variable_get(v)] }
          b = Builder.new(res.source, @env)
          params = b.with_ctx(:def, @fqn) { b.params(bnode.parameters) }
          body = substitute(b.with_ctx(:def, @fqn) { b.seq(bnode.body) }, bind)
          return [{ k: "def", name: args.first.to_s, singleton: name == :define_singleton_method, params: params, body: body, l: bnode.location.start_line, expanded: true }]
        end
        return [] if blk_node.nil?
        dm = find_call(blk_node.body, :define_method)
        return [] unless dm&.block.is_a?(Prism::BlockNode)
        bind = pnames.zip(vals).to_h
        body = substitute(@b.with_ctx(:def, @fqn) { @b.seq(dm.block.body) }, bind)
        [{ k: "def", name: args.first.to_s, singleton: false, params: @b.params(dm.block.parameters), body: body, l: dm.location.start_line, expanded: true }]
      else
        ir_args = args.map { |a| lit(a) }
        ir_args << { k: "kwargs", pairs: kw.map { |k, v| { key: lit(k), value: lit(v) } } } unless kw.empty?
        return [] if ir_args.any?(&:nil?)
        [{ k: "call", recv: nil, name: name.to_s, args: ir_args, block: nil, safe: false, l: (blk_node ? blk_node.location.start_line : 0), expanded: true }]
      end
    end

    def find_call(node, name)
      return nil if node.nil?
      return node if node.is_a?(Prism::CallNode) && node.name == name
      node.compact_child_nodes.each do |c|
        r = find_call(c, name)
        return r if r
      end
      nil
    end

    def substitute(ir, bind)
      case ir
      when Array then ir.map { |x| substitute(x, bind) }
      when Hash
        if ir[:k] == "lvar" && bind.key?(ir[:name]) && (l = lit(bind[ir[:name]]))
          l
        else
          out = ir.transform_values { |v| substitute(v, bind) }
          if %w[dstr dsym].include?(out[:k]) && out[:parts].all? { |p| %w[str sym].include?(p[:k]) }
            s = out[:parts].map { |p| p[:value] }.join
            out = out[:k] == "dsym" ? { k: "sym", value: s } : { k: "str", value: s }
          end
          out
        end
      else ir
      end
    end

    def lit(v)
      case v
      when Symbol then { k: "sym", value: v.to_s }
      when String then { k: "str", value: v }
      when Integer then { k: "int", value: v.to_s }
      when Float then { k: "float", value: v }
      when nil then { k: "nil" }
      when true then { k: "true" }
      when false then { k: "false" }
      when Array then { k: "array", elems: v.map { |x| lit(x) } }
      when Hash then { k: "hash", pairs: v.map { |a, b| { key: lit(a), value: lit(b) } } }
      when Module then { k: "const", path: v.to_s.split("::") }
      end
    end
  end
end

require "set"
$expansion_failures = []
root, *files = ARGV
# An ERB template becomes the body of one method: each `<%= e %>` an
# `__out((e))`, each `<% code %>` its code. Markup is compared separately, from
# the template text, so it is left out here.
def erb_to_ruby(src)
  code = +"def __template;"
  src.scan(/<%(=|#)?-?(.*?)-?%>/m) do |kind, body|
    next if kind == "#"
    # Pad to the tag's template line, so a line in the IR is a line in the .erb.
    line = src[0, Regexp.last_match.begin(0)].count("\n") + 1
    code << "\n" * [line - (code.count("\n") + 1), 0].max
    code << (kind == "=" ? "__out((#{body.strip}));" : "#{body.strip};")
  end
  code << "\n"
  code << "end\n"
end

out = files.map do |f|
  result = f.end_with?(".erb") ? Prism.parse(erb_to_ruby(File.read(f)), filepath: f) : Prism.parse_file(f)
  b = CodegenIR::Builder.new(result.source, nil)
  { file: f.delete_prefix(root).delete_prefix("/"), body: b.build_program(result.value), unhandled: b.unhandled_counts }
end
$stdout.write(JSON.generate(out))
