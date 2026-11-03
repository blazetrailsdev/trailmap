import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Owner } from "../../../app/models/owner.ts";
import { viewerOf } from "../../../app/controllers/concerns/viewer.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../../support/hub-schema.ts";

/** A request carrying `Remote-User`, as Authelia's proxy sets it, or none. */
function request(remoteUser?: string): { getHeader(key: string): unknown } {
  return { getHeader: (key) => (key === "HTTP_REMOTE_USER" ? remoteUser : undefined) };
}

describe("viewerOf, anonymous", () => {
  it("is nobody for a request with no Remote-User, as on loopback", async () => {
    expect(await viewerOf(request())).toBeNull();
  });

  it("is nobody for a blank Remote-User", async () => {
    expect(await viewerOf(request("   "))).toBeNull();
  });
});

describe.skipIf(!hasHubTestDatabase())("viewerOf, signed in", () => {
  beforeAll(async () => {
    await connectHubTestDatabase();
    await Owner.create({ login: "viewer-test", kind: "user" });
  }, HUB_SETUP_TIMEOUT);
  // Hands the hub to the next test file; see `releaseHubTestDatabase`.
  afterAll(releaseHubTestDatabase);

  it("is the Owner whose login the proxy names, whatever its case", async () => {
    expect((await viewerOf(request("viewer-test")))?.login).toBe("viewer-test");
    expect((await viewerOf(request(" Viewer-Test ")))?.login).toBe("viewer-test");
  });

  it("is nobody for a signed-in user the hub does not know", async () => {
    expect(await viewerOf(request("stranger"))).toBeNull();
  });
});
