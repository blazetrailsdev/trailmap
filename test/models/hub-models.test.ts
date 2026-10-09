import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import {
  connectHubTestDatabase,
  hasHubTestDatabase,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.js";
import { Owner } from "../../app/models/owner.js";
import { Repository } from "../../app/models/repository.js";
import {
  ALL_TABS_ENABLED,
  OPTIONAL_TABS,
  RepositorySetting,
} from "../../app/models/repository-setting.js";
import { Setting } from "../../app/models/setting.js";

/**
 * The hub models, against a real Postgres database.
 *
 * `describe.skipIf` rather than a silent pass: a hub test that quietly does
 * nothing when the database is missing is the failure mode
 * `live-database-tests-never-run-in-ci-and-three-have-rotted` (RFC 0136) is
 * about — three tests had rotted behind exactly that. vitest prints the
 * skipped names, so the gap is visible in the run.
 */
describe.skipIf(!hasHubTestDatabase())("the hub models", () => {
  beforeAll(async () => {
    await connectHubTestDatabase();
  });
  beforeEach(async () => {
    await truncateHub();
  });
  // Hands the hub to the next test file; see `releaseHubTestDatabase`.
  afterAll(releaseHubTestDatabase);

  describe("Owner", () => {
    it("is a user or an organization, labelled as stored", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });

      expect(owner.kind).toBe("organization");
      expect(owner.isOrganization()).toBe(true);
      expect(owner.isUser()).toBe(false);
      // The enum's statics, and the identity mapping: a label that differed
      // from the stored value would make `owner.kind` and `SELECT kind`
      // disagree.
      expect((await Owner.organization().toArray()).map((o) => o.login)).toEqual([
        "blazetrailsdev",
      ]);
      expect(await Owner.user().count()).toBe(0);
    });

    it("refuses a login that is empty, malformed or already taken", async () => {
      await Owner.create({ login: "taken", kind: "user" });

      for (const login of ["", "-leading", "trailing-", "has space", "two--hyphens"]) {
        const bad = Owner.build({ login, kind: "user" });
        expect(await bad.save()).toBe(false);
      }
      // Case-insensitively taken, as GitHub treats it and as `findByLogin`
      // resolves it.
      const dup = Owner.build({ login: "TAKEN", kind: "user" });
      expect(await dup.save()).toBe(false);
    });

    it("finds an owner by login whatever the case", async () => {
      await Owner.create({ login: "blazetrailsdev", kind: "organization" });

      expect((await Owner.findByLogin("BlazeTrailsDev"))?.login).toBe("blazetrailsdev");
      expect(await Owner.findByLogin("nobody")).toBeNull();
    });

    it("shows its display name when it has one, else its login", async () => {
      const bare = await Owner.create({ login: "bare", kind: "user" });
      const named = await Owner.create({ login: "named", kind: "user", display_name: "A Name" });

      expect(bare.title()).toBe("bare");
      expect(named.title()).toBe("A Name");
    });
  });

  describe("Repository", () => {
    it("belongs to an owner and is unique within it, not globally", async () => {
      const one = await Owner.create({ login: "one", kind: "organization" });
      const two = await Owner.create({ login: "two", kind: "organization" });

      expect(await Repository.create({ owner_id: one.id, name: "trails" })).toBeTruthy();
      // The same name under a DIFFERENT owner is fine — that is what the
      // scoped uniqueness is for.
      expect(await Repository.create({ owner_id: two.id, name: "trails" })).toBeTruthy();

      const dup = Repository.build({ owner_id: one.id, name: "TRAILS" });
      expect(await dup.save()).toBe(false);
    });

    it("defaults its branch and visibility, and prefixes the visibility enum", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });

      expect(repo.default_branch).toBe("main");
      expect(repo.visibility).toBe("public");
      // `visibilityPublic`, not `public`: trails refuses an enum that would
      // generate a class method it already defines.
      expect((await Repository.visibilityPublic().toArray()).map((r) => r.name)).toEqual([
        "trails",
      ]);
      expect(await Repository.visibilityPrivate().count()).toBe(0);
    });

    it("loads its owner and settings in one lookup by name-with-owner", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });
      await RepositorySetting.create({ repository_id: repo.id, wiki_enabled: false });

      const found = await Repository.findByNwo("BlazeTrailsDev", "TRAILS");

      expect(found?.nameWithOwner()).toBe("blazetrailsdev/trails");
      expect(found?.owner?.login).toBe("blazetrailsdev");
      expect(found?.settings?.wiki_enabled).toBe(false);
      expect(await Repository.findByNwo("nobody", "trails")).toBeNull();
      expect(await Repository.findByNwo("blazetrailsdev", "nothing")).toBeNull();
    });

    it("imports FLEET_REPO_PATHS, updates the checkout path, and deletes nothing", async () => {
      setEnv("FLEET_REPO_PATHS", "blazetrailsdev/trails=/checkout/trails");
      expect((await Repository.importFleetRepos()).map((r) => r.name)).toEqual(["trails"]);
      expect((await Repository.findByNwo("blazetrailsdev", "trails"))?.checkout_path).toBe(
        "/checkout/trails",
      );
      // It created the owner it needed, as an organization.
      expect((await Owner.findByLogin("blazetrailsdev"))?.kind).toBe("organization");

      setEnv("FLEET_REPO_PATHS", "blazetrailsdev/trails=/moved/trails");
      await Repository.importFleetRepos();
      expect((await Repository.findByNwo("blazetrailsdev", "trails"))?.checkout_path).toBe(
        "/moved/trails",
      );
      expect(await Repository.count()).toBe(1);

      // A repo missing from the variable is NOT removed: the variable lists
      // what one box offers, which is a subset of what the hub knows.
      setEnv("FLEET_REPO_PATHS", "");
      await Repository.importFleetRepos();
      expect(await Repository.count()).toBe(1);
    });
  });

  describe("RepositorySetting", () => {
    it("turns every optional tab on by default", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });
      const settings = await RepositorySetting.create({ repository_id: repo.id });

      for (const tab of OPTIONAL_TABS) expect(settings.enabled(tab)).toBe(true);
    });

    it("answers true for a tab that has no switch at all", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });
      const settings = await RepositorySetting.create({
        repository_id: repo.id,
        issues_enabled: false,
      });

      expect(settings.enabled("issues")).toBe(false);
      // Code and settings cannot be turned off, and a typo must not make a
      // page unreachable.
      expect(settings.enabled("code")).toBe(true);
      expect(settings.enabled("settings")).toBe(true);
      expect(settings.enabled("isssues")).toBe(true);
    });

    it("turns everything on for a repository whose row has not been written", () => {
      // A tab that 404s for want of a row would look exactly like a tab
      // someone deliberately turned off, so the default is opt-OUT even
      // before `RepositorySetting.create` has run.
      for (const tab of OPTIONAL_TABS) expect(ALL_TABS_ENABLED.enabled(tab)).toBe(true);
      expect(ALL_TABS_ENABLED.enabled("code")).toBe(true);
    });

    it("is one row per repository", async () => {
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });
      await RepositorySetting.create({ repository_id: repo.id });

      const second = RepositorySetting.build({ repository_id: repo.id });
      expect(await second.save()).toBe(false);
    });
  });

  describe("Setting", () => {
    it("prefers a row over the environment, and treats a blank row as unset", async () => {
      setEnv("RINGO_BASE", "http://from-the-environment:8080");
      expect(await Setting.lookup("ringo_base")).toBe("http://from-the-environment:8080");

      await Setting.write("ringo_base", "http://from-the-database:8080");
      expect(await Setting.lookup("ringo_base")).toBe("http://from-the-database:8080");

      // A blank value is not an override: a settings form that cleared the
      // field must not shadow a working variable with nothing.
      await Setting.write("ringo_base", "   ");
      expect(await Setting.lookup("ringo_base")).toBe("http://from-the-environment:8080");
    });

    it("upserts rather than duplicating a key", async () => {
      await Setting.write("fleet_socket_path", "/one");
      await Setting.write("fleet_socket_path", "/two");

      expect(await Setting.count()).toBe(1);
      expect(await Setting.lookup("fleet_socket_path")).toBe("/two");
    });

    it("is null when neither the row nor the environment has a value", async () => {
      setEnv("FLEET_CONTROL_PATH", "");
      expect(await Setting.lookup("fleet_control_path")).toBeNull();
    });
  });

  /**
   * The ONE resolver for ringo's origin. `config/fleet.ts` used to carry a
   * second, env-only one of the same name; these are both suites' cases,
   * together, because the value has one answer and one place that gives it.
   */
  describe("Setting.ringoBase", () => {
    it("is the environment's value, trimmed and without its trailing slash", async () => {
      setEnv("RINGO_BASE", "  http://btwhooks.web:8080/  ");

      expect(await Setting.ringoBase()).toBe("http://btwhooks.web:8080");
    });

    it("normalises a row the same way, and the row wins", async () => {
      setEnv("RINGO_BASE", "http://btwhooks.web:8080");
      await Setting.write("ringo_base", "  http://other.web:9090//  ");

      // Same normalising for both sources: otherwise a relay built
      // `http://host//events` from one and `http://host/events` from the other.
      expect(await Setting.ringoBase()).toBe("http://other.web:9090");
    });

    it("is null when the deployment names no ringo", async () => {
      setEnv("RINGO_BASE", "");
      expect(await Setting.ringoBase()).toBeNull();

      setEnv("RINGO_BASE", "   ");
      expect(await Setting.ringoBase()).toBeNull();
    });

    it("is null when a row is blanked, rather than shadowing the variable", async () => {
      setEnv("RINGO_BASE", "http://btwhooks.web:8080");
      await Setting.write("ringo_base", "   ");

      // A settings form that cleared the field falls back; it does not leave
      // the fleet with no origin while a working variable is sitting there.
      expect(await Setting.ringoBase()).toBe("http://btwhooks.web:8080");
    });
  });

  describe("loadHubSchemas", () => {
    it("has reflected every hub model's columns, so an enum resolves", async () => {
      // The hub twin of `schema-loading.test.ts`: `enum` resolves its storage
      // type from the reflected column, reflection is lazy, and reaching a
      // model first THROUGH AN ASSOCIATION never loads it. `connectHubTestDatabase`
      // calls `loadHubSchemas`, as the initializer does.
      const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
      const repo = await Repository.create({ owner_id: owner.id, name: "trails" });
      await RepositorySetting.create({ repository_id: repo.id });

      const found = await Owner.findByLogin("blazetrailsdev");
      const viaAssociation = await found!.repositories.toArray();
      expect(viaAssociation.map((r) => r.visibility)).toEqual(["public"]);
      expect(viaAssociation[0]!.isVisibilityPublic()).toBe(true);
    });
  });
});
