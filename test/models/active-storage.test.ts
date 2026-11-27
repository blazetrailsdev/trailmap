import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Extended } from "@blazetrails/activesupport";
import { StringIO, TopLevel, constSet, rbModRemoveConst } from "@blazetrails/ruby-compat";
import type { ClassMethods } from "@blazetrails/activestorage/attached/model";
import type { One } from "@blazetrails/activestorage/attached/one";
import { ApplicationRecord } from "../../app/models/application-record.ts";

/**
 * A throwaway record over `events`, whose integer id fits
 * `active_storage_attachments.record_id`: no trailmap model attaches yet.
 */
class User extends ApplicationRecord {
  declare avatar: One;

  static {
    this.tableName = "events";
    (this as unknown as Extended<typeof ClassMethods>).hasOneAttached("avatar");
  }
}
constSet(TopLevel, "User", User);

describe("ActiveStorage on Base", () => {
  beforeAll(() => User.loadSchema());
  afterAll(() => rbModRemoveConst(TopLevel, "User"));

  it("attaching a new blob from a Hash to an existing record", async () => {
    const user = await User.create({ at: "2026-11-18T00:00:00Z", verb: "attach" });
    await user.avatar.attach({
      io: new StringIO("STUFF"),
      filename: "town.jpg",
      contentType: "image/jpeg",
    });

    const blob = (await (await user.avatar.attachment)!.blob)!;
    expect(blob.filename.toString()).toBe("town.jpg");
    expect(blob.service.name).toBe("test");
    expect(new TextDecoder().decode(await blob.download())).toBe("STUFF");
  });
});
