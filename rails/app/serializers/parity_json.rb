# Projected rows grouped into one series per package, in the CALLER's
# package order (the page colours by position). A pure mapping: the rows are
# already measured. The shape is ringo's, read by its vendored drawing code.
module ParityJson
  module_function

  def series(rows, metric_key, packages)
    by_package = Hash.new { |h, k| h[k] = [] }
    rows.each do |row|
      point = { date: row.day.iso8601, pr: row.pr_number.to_i, percent: js_number(row.percent),
                matched: row.matched.to_i, total: row.total.to_i }
      point[:gaps] = row.gaps if row.gaps.present?
      by_package[row.package] << point
    end
    packages.select { |p| by_package.key?(p) }.map { |p| { metric: metric_key, package: p, points: by_package[p] } }
  end

  # A number as JavaScript's JSON writes it: `93`, not Ruby's `93.0`.
  def js_number(value)
    f = value.to_f
    f == f.truncate ? f.to_i : f
  end
end
