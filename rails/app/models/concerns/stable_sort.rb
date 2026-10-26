# A stable sort by comparator.
#
# Ruby's `sort` is not stable and JavaScript's `Array#sort` is: trailmap's
# ranking and list orders lean on ties keeping their input order, so every
# port of a JS `.sort(cmp)` goes through here.
module StableSort
  def self.sort(items, &cmp)
    items.each_with_index
         .sort { |(a, i), (b, j)| cmp.call(a, b).nonzero? || i <=> j }
         .map(&:first)
  end
end
