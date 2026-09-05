import { Migration } from "@blazetrails/activerecord";

export class AddIndexFields extends Migration {
  async change() {
    // Fields index.json carries that the first cut of the schema missed.
    //
    // Date handling is exact on purpose: js-yaml parses unquoted `updated:
    // 2026-07-04` into a JS Date, so JSON.stringify emits ISO midnight. All
    // 7,153 stories and 123 RFCs serialize that way uniformly (verified), so we
    // store the date-only string and let the read-model re-derive the ISO form.
    // `claim:` is quoted in frontmatter and stays a plain ISO-seconds string.
    await this.addColumn("stories", "updated_on", "string");

    await this.addColumn("rfcs", "created_on", "string");
    await this.addColumn("rfcs", "updated_on", "string");
    // Display-only lists — nothing filters RFCs by package or cluster, so a
    // JSON column beats four more join tables here. Story packages/paths DO get
    // join tables, because `touching` and package filters query them.
    await this.addColumn("rfcs", "packages", "text");
    await this.addColumn("rfcs", "clusters", "text");
    await this.addColumn("rfcs", "related_rfcs", "text");
  }
}
