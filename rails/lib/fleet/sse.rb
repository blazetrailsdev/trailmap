module Fleet
  # Split a server-sent-event stream into the `data` of each complete event.
  # The caller keeps `rest` and hands it back with the next chunk. A trailing
  # `\r` might be half of `\r\n`, so it waits in `rest`.
  module Sse
    def self.data(buffer)
      held = buffer.end_with?("\r") ? "\r" : ""
      normalized = buffer[0, buffer.length - held.length].gsub(/\r\n?/, "\n")
      events = normalized.split("\n\n", -1)
      rest = events.pop.to_s + held
      data = events.filter_map do |event|
        lines = event.split("\n").select { |l| l.start_with?("data:") }.map { |l| l[5..].delete_prefix(" ") }
        lines.join("\n") if lines.any?
      end
      [ data, rest ]
    end
  end
end
