import { Base } from "@blazetrails/activerecord";

export class ApplicationRecord extends Base {
  static {
    this.primaryAbstractClass();
  }
}
