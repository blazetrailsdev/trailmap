module ApplicationHelper
  # The word a status badge shows, and the suffix of its `s-` class. Blank is
  # `unknown`, ringo's arm for a dep whose RFC is missing.
  def status_word(status)
    status.to_s.strip.presence || "unknown"
  end

  # A number as JavaScript prints it: `50`, never Ruby's `50.0`. The `.tse`
  # views interpolate numbers straight into widths and labels, so the same
  # value has to print the same way here.
  def js_num(value)
    return value unless value.is_a?(Float)
    value == value.truncate ? value.to_i.to_s : value.to_s
  end
end
