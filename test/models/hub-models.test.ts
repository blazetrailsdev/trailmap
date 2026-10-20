import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.js";
import { setEnv } from "@blazetrails/ruby-compat";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
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
import { fleetRepos } from "../../config/fleet.js";
import { RepositoryCollaborator } from "../../app/models/repository-collaborator.js";

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
  }, HUB_SETUP_TIMEOUT);
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
    it("belongs to an owner, and its name is unique GLOBALLY", async () => {
      const one = await Owner.create({ login: "one", kind: "organization" });
      const two = await Owner.create({ login: "two", kind: "organization" });

      const first = await Repository.createBang({ owner_id: one.id, name: "trails" });
      expect(first.isPersisted()).toBe(true);
      expect(first.owner_id).toBe(one.id);

      // The same name under a DIFFERENT owner is REFUSED. `repo-scope.ts` maps
      // a story to a repository through `stories.pr`, which is `repo#N` with
      // no owner in it, so a second `trails` would inherit the first one's
      // nine thousand stories.
      const second = Repository.build({ owner_id: two.id, name: "trails" });
      expect(await second.save()).toBe(false);
      expect(second.isPersisted()).toBe(false);
      expect(second.errors.fullMessages.join(" ")).toMatch(/name/i);

      // Case-insensitively, under either owner.
      expect(await Repository.build({ owner_id: one.id, name: "TRAILS" }).save()).toBe(false);
      expect(await Repository.build({ owner_id: two.id, name: "Trails" }).save()).toBe(false);
    });

    it("is refused by the DATABASE too, when validations are skipped", async () => {
      // A validation races and `insertAll` skips it outright, so the index is
      // what actually keeps the scope's assumption true.
      // `index_repositories_on_lower_name`.
      const one = await Owner.create({ login: "one", kind: "organization" });
      const two = await Owner.create({ login: "two", kind: "organization" });
      await Repository.createBang({ owner_id: one.id, name: "trails" });

      await expect(
        Repository.connectionPool().withConnection((connection) =>
          connection.execute(
            `INSERT INTO repositories (owner_id, name, default_branch, visibility, archived,
               created_at, updated_at)
             VALUES (${two.id}, 'TRAILS', 'main', 'public', false, NOW(), NOW())`,
          ),
        ),
      ).rejects.toThrow(/index_repositories_on_lower_name|unique/i);
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
      setX("fleet", "repoPaths", "blazetrailsdev/trails=/checkout/trails");
      expect((await Repository.importFleetRepos()).map((r) => r.name)).toEqual(["trails"]);
      expect((await Repository.findByNwo("blazetrailsdev", "trails"))?.checkout_path).toBe(
        "/checkout/trails",
      );
      // It created the owner it needed, as an organization.
      expect((await Owner.findByLogin("blazetrailsdev"))?.kind).toBe("organization");

      setX("fleet", "repoPaths", "blazetrailsdev/trails=/moved/trails");
      await Repository.importFleetRepos();
      expect((await Repository.findByNwo("blazetrailsdev", "trails"))?.checkout_path).toBe(
        "/moved/trails",
      );
      expect(await Repository.count()).toBe(1);

      // A repo missing from the variable is NOT removed: the variable lists
      // what one box offers, which is a subset of what the hub knows.
      setX("fleet", "repoPaths", "");
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
      await Setting.write("ringo_base", "http://one.web:8080");
      await Setting.write("ringo_base", "http://two.web:8080");

      expect(await Setting.count()).toBe(1);
      expect(await Setting.lookup("ringo_base")).toBe("http://two.web:8080");
    });

    it("is null when neither the row nor the environment has a value", async () => {
      setEnv("RINGO_BASE", "");
      expect(await Setting.lookup("ringo_base")).toBeNull();
    });

    it("knows only settings something actually reads", () => {
      // The guard against the thing this list grew by accident: two keys that
      // named `config/fleet.ts` CONSTANTS rather than environment variables,
      // so a row overrode nothing and the settings page offered a knob that
      // did not turn.
      expect(Object.keys(Setting.FALLBACKS)).toEqual(["ringo_base"]);
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

  describe("a reserved login", () => {
    it("is refused, in any case", async () => {
      // `dashboard` is a page. An owner by that name is reachable at
      // `/Dashboard` only, because the route constraint takes `/dashboard` —
      // an owner that half exists.
      for (const login of ["dashboard", "Dashboard", "DASHBOARD", "RFCs"]) {
        const owner = Owner.build({ login, kind: "user" });

        expect([login, await owner.save()]).toEqual([login, false]);
        expect(owner.errors.fullMessages.join(" ")).toMatch(/reserved/i);
      }
    });

    it("does not refuse a login that merely contains one", async () => {
      const owner = Owner.build({ login: "dashboards-r-us", kind: "user" });

      expect(await owner.save()).toBe(true);
    });
  });

  describe("destroying an owner or a repository", () => {
    it("takes its repositories, their settings and their collaborators", async () => {
      const owner = await Owner.createBang({ login: "one", kind: "organization" });
      const member = await Owner.createBang({ login: "member", kind: "user" });
      const repo = await Repository.createBang({ owner_id: owner.id, name: "trails" });
      await RepositorySetting.createBang({ repository_id: repo.id });
      await RepositoryCollaborator.createBang({
        repository_id: repo.id,
        owner_id: member.id,
        role: "admin",
      });

      await owner.destroy();

      // `dependent: "destroy"` down to the repositories and their settings,
      // `deleteAll` for the join rows — which have no callbacks and a
      // composite key.
      expect(await Repository.count()).toBe(0);
      expect(await RepositorySetting.count()).toBe(0);
      expect(await RepositoryCollaborator.count()).toBe(0);
      // The collaborator is a person, not a detail of the repository.
      expect(await Owner.findByLogin("member")).not.toBeNull();
    });

    it("takes a repository's settings and collaborators with it", async () => {
      const owner = await Owner.createBang({ login: "one", kind: "organization" });
      const member = await Owner.createBang({ login: "member", kind: "user" });
      const repo = await Repository.createBang({ owner_id: owner.id, name: "trails" });
      await RepositorySetting.createBang({ repository_id: repo.id });
      await RepositoryCollaborator.createBang({
        repository_id: repo.id,
        owner_id: member.id,
        role: "read",
      });

      await repo.destroy();

      expect(await RepositorySetting.count()).toBe(0);
      expect(await RepositoryCollaborator.count()).toBe(0);
      expect(await Owner.findByLogin("one")).not.toBeNull();
    });
  });

  describe("Repository.spawnChoices", () => {
    it("is the environment's entries when the hub holds no checkout", async () => {
      setX("fleet", "repoPaths", "blazetrailsdev/trails=/checkout/trails");

      expect(await Repository.spawnChoices()).toEqual([
        { name: "blazetrailsdev/trails", path: "/checkout/trails" },
      ]);
    });

    it("lets a row OVERRIDE the environment entry of the same name", async () => {
      setX("fleet", "repoPaths", "blazetrailsdev/trails=/stale/trails");
      const owner = await Owner.createBang({ login: "blazetrailsdev", kind: "organization" });
      await Repository.createBang({
        owner_id: owner.id,
        name: "trails",
        checkout_path: "/moved/trails",
      });

      expect(await Repository.spawnChoices()).toEqual([
        { name: "blazetrailsdev/trails", path: "/moved/trails" },
      ]);
    });

    it("still offers an environment entry that has no row", async () => {
      // The all-or-nothing version dropped this one the moment any row
      // existed, so adding a repo to FLEET_REPO_PATHS did nothing until
      // someone reseeded.
      setX("fleet", "repoPaths",
        "blazetrailsdev/trails=/checkout/trails,blazetrailsdev/ringo=/checkout/ringo",
      );
      const owner = await Owner.createBang({ login: "blazetrailsdev", kind: "organization" });
      await Repository.createBang({
        owner_id: owner.id,
        name: "trails",
        checkout_path: "/moved/trails",
      });

      expect(await Repository.spawnChoices()).toEqual([
        { name: "blazetrailsdev/ringo", path: "/checkout/ringo" },
        { name: "blazetrailsdev/trails", path: "/moved/trails" },
      ]);
    });

    it("is alphabetical, as the environment reader already was", async () => {
      // NOT a change this branch makes: `fleetRepos()` sorts (config/fleet.ts),
      // so `FLEET_REPO_PATHS` never decided the order. The dashboard's first
      // `<option>` is the default spawn target, and on an env-only box it must
      // be the same repository after this change as before it.
      setX("fleet", "repoPaths",
        "blazetrailsdev/zebra=/checkout/zebra,blazetrailsdev/alpha=/checkout/alpha",
      );

      expect((await Repository.spawnChoices()).map((choice) => choice.name)).toEqual([
        "blazetrailsdev/alpha",
        "blazetrailsdev/zebra",
      ]);
      // The merge agrees with the reader it merges over.
      expect(await Repository.spawnChoices()).toEqual(fleetRepos());
    });

    it("sorts a row-only entry in with the environment's, not after them", async () => {
      setX("fleet", "repoPaths", "blazetrailsdev/zebra=/checkout/zebra");
      const owner = await Owner.createBang({ login: "blazetrailsdev", kind: "organization" });
      await Repository.createBang({
        owner_id: owner.id,
        name: "alpha",
        checkout_path: "/checkout/alpha",
      });

      expect((await Repository.spawnChoices()).map((choice) => choice.name)).toEqual([
        "blazetrailsdev/alpha",
        "blazetrailsdev/zebra",
      ]);
    });

    it("leaves out a row with no checkout, and an archived one", async () => {
      setX("fleet", "repoPaths", "");
      const owner = await Owner.createBang({ login: "blazetrailsdev", kind: "organization" });
      await Repository.createBang({ owner_id: owner.id, name: "trails" });
      await Repository.createBang({
        owner_id: owner.id,
        name: "ringo",
        checkout_path: "/checkout/ringo",
        archived: true,
      });

      expect(await Repository.spawnChoices()).toEqual([]);
    });
  });

  describe("Repository.importFleetRepos", () => {
    it("raises rather than reporting success on a name the model refuses", async () => {
      // `createBang`, not `create`: `create` answers an unsaved record, and
      // the seeds then printed "seeded" over a database with nothing in it.
      setX("fleet", "repoPaths", "blazetrailsdev/not a repo name=/checkout/x");

      await expect(Repository.importFleetRepos()).rejects.toThrow();
    });
  });

  describe("the settings memo", () => {
    /**
     * Change the row WITHOUT going through `Setting.write`, which clears the
     * memo. This is what another process does, and it is the only way to see
     * whether this one is reading its cache or the database.
     */
    async function updateRowBehindTheModel(value: string): Promise<void> {
      await Setting.connectionPool().withConnection((connection) =>
        connection.execute(`UPDATE settings SET value = '${value}' WHERE key = 'ringo_base'`),
      );
    }

    it("is dropped by `write`, so a new value takes effect at once", async () => {
      setEnv("RINGO_BASE", "");
      await Setting.write("ringo_base", "http://first.web:8080");
      expect(await Setting.ringoBase()).toBe("http://first.web:8080");

      // The read above filled the memo. Without `write` clearing it, this
      // value would not be visible for another ten seconds.
      await Setting.write("ringo_base", "http://second.web:8080");

      expect(await Setting.ringoBase()).toBe("http://second.web:8080");

      // And the same again after a read that is served FROM the memo, which is
      // the state the clearing actually has to survive.
      await updateRowBehindTheModel("http://out-of-band:7070");
      expect(await Setting.ringoBase()).toBe("http://second.web:8080");

      await Setting.write("ringo_base", "http://third.web:8080");
      expect(await Setting.ringoBase()).toBe("http://third.web:8080");
    });

    it("caches the ROW, and re-reads the environment every call", async () => {
      // The memo exists to stop the polled relay paths querying Postgres per
      // request. It must not freeze the env fallback with them.
      setEnv("RINGO_BASE", "http://from-env:8080");
      expect(await Setting.ringoBase()).toBe("http://from-env:8080");

      setEnv("RINGO_BASE", "http://changed:9090");

      expect(await Setting.ringoBase()).toBe("http://changed:9090");

      // The ROW half: write one, read it (filling the memo), then move it
      // behind the model's back. A process with no cache would see the new
      // value at once; this one must not, which is the whole point of the
      // memo and the only assertion here that fails if it is deleted.
      await Setting.write("ringo_base", "http://from-the-row:8080");
      expect(await Setting.ringoBase()).toBe("http://from-the-row:8080");

      await updateRowBehindTheModel("http://moved:7070");
      expect(await Setting.ringoBase()).toBe("http://from-the-row:8080");

      // ...until the memo is dropped, as `truncateHub` and a passing TTL do.
      Setting.forgetResolved();
      expect(await Setting.ringoBase()).toBe("http://moved:7070");
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
