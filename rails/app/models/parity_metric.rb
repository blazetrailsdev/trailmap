# One measure the parity page can chart: a model plus the two columns whose
# ratio it is, and the subtrahend for the assertion checks. A frozen list,
# because these are a property of what CI runs.
ParityMetric = Data.define(:key, :label, :model_name, :num, :den, :sub, :gaps) do
  def self.all
    @all ||= [
      new(key: "api", label: "api:compare", model_name: "ApiCompareStat", gaps: %w[misplaced missing]),
      new(key: "api_privates", label: "api:compare --privates", model_name: "ApiComparePrivatesStat", gaps: %w[missing]),
      new(key: "test", label: "test:compare", model_name: "TestCompareStat",
          gaps: %w[misplaced skipped assertion_count_mismatch assertion_kind_mismatch]),
      new(key: "test_files", label: "test:compare files", model_name: "TestCompareStat", num: "files_mapped", den: "files_total"),
      new(key: "test_assert_count", label: "test:compare assertion counts", model_name: "TestCompareStat",
          num: "matched", den: "matched", sub: "assertion_count_mismatch"),
      new(key: "test_assert_kind", label: "test:compare assertion kinds", model_name: "TestCompareStat",
          num: "matched", den: "matched", sub: "assertion_kind_mismatch"),
      new(key: "calls", label: "api:compare --calls", model_name: "ApiCallsStat", gaps: %w[mismatched]),
      new(key: "call_args", label: "calls:args", model_name: "ApiCallArgsStat", gaps: %w[mismatched])
    ].freeze
  end

  def self.lookup(key)
    all.find { |m| m.key == key }
  end

  def initialize(key:, label:, model_name:, num: nil, den: nil, sub: nil, gaps: nil)
    super
  end

  def model
    model_name.constantize
  end

  def numerator
    num || "matched"
  end

  def denominator
    den || "total"
  end

  # Whether this is its run's own headline number, whose `percent` CI wrote.
  def native?
    numerator == "matched" && denominator == "total" && sub.nil?
  end

  def columns
    cols = [ numerator, denominator ]
    cols << sub if sub
    cols << "percent" if native?
    cols.uniq
  end

  # Gap columns the database has; nil (ringo's JSON null) for none.
  def present_gaps
    return nil if gaps.blank?
    model.present_columns(gaps).presence
  end

  def available?
    names = model.column_names
    names.any? && (columns - names).empty?
  end

  # One rollup row's numerator, denominator and percent: the ONLY copy of
  # this arithmetic.
  def measure(row)
    num_v = row[numerator].to_i
    den_v = row[denominator].to_i
    matched = num_v - (sub ? row[sub].to_i : 0)
    percent = native? ? row["percent"].to_f : (den_v.positive? ? ((1000.0 * matched / den_v) + 0.5).floor / 10.0 : 0)
    { matched: matched, total: den_v, percent: percent }
  end
end
