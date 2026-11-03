import { ApplicationRecord } from "./application-record.ts";

export class StoryPackage extends ApplicationRecord {
  static {
    this.belongsTo("story");
  }
}
