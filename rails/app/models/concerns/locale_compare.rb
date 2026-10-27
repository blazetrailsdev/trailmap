# JavaScript's `String#localeCompare` with no locale, which the TypeScript app
# sorts names and ids with: ICU root collation. Ruby's `String#<=>` is byte
# order, which disagrees on punctuation (`_` sorts before `-` in ICU) and on
# case (`a` < `B` < `b` in ICU). Same outputs means sorting the same way, so
# every port of a `localeCompare` goes through here.
#
# ASCII only, which is what ids, logins and repository names are: CLDR's root
# order for punctuation and symbols, then digits, then letters case-folded,
# with lowercase first as the tertiary tiebreak. An accented Latin letter
# takes its base letter's weight (`é` sorts with `e`), and sorts after it on a
# tie. Anything else sorts after ASCII by code point.
module LocaleCompare
  ORDER = "\t\n\v\f\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz"
  PRIMARY = ORDER.each_char.with_index.to_h
  ORDER.upcase.each_char.with_index { |c, i| PRIMARY[c] ||= i if c.match?(/[A-Z]/) }

  module_function

  def compare(a, b)
    primary = key(a) <=> key(b)
    return primary unless primary.zero?
    accents = a.count("^\u0000-\u007F") <=> b.count("^\u0000-\u007F")
    return accents unless accents.zero?
    # Tertiary: lowercase before uppercase at the first case difference.
    a.each_char.zip(b.each_char).each do |x, y|
      next if x == y || x.nil? || y.nil?
      return x.match?(/[a-z]/) ? -1 : 1 if x.downcase == y.downcase
    end
    0
  end

  def key(s)
    s.each_char.map { |c| PRIMARY.fetch(c) { PRIMARY.fetch(c.unicode_normalize(:nfd)[0]) { 1000 + c.ord } } }
  end
end
