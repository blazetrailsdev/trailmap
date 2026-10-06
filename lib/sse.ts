/**
 * Split a server-sent-event stream into the `data` of each complete event.
 *
 * ringo's `/events` writes `data: <json>\n\n` frames. A read from the network
 * ends wherever the network likes, so the caller keeps `rest` and hands it back
 * with the next chunk. Comment lines and fields other than `data` are dropped:
 * ringo sends none that the fleet page reads.
 */
export function sseData(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events = normalized.split("\n\n");
  const rest = events.pop() ?? "";
  for (const event of events) {
    const lines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (lines.length > 0) data.push(lines.join("\n"));
  }
  return { data, rest };
}
