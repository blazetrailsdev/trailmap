import { afterEach, describe, expect, it } from "vitest";
import { Trails } from "@blazetrails/trailties";
import "../../config/application.ts";
import { deployLogName, deployLogsDir, readDeployLog, readsDeployLogLocally } from "../../app/models/deploy-log.ts";
import { DeploysHelper } from "../../app/helpers/deploys-helper.ts";

const mount = (dir: string | undefined) => {
  Trails.application!.config.x.deploys.logsDir = dir;
};

afterEach(() => mount(undefined));

describe("DeployLog", () => {
  it("deployLogsDir trims the mount and its trailing slash, and is empty unset", () => {
    expect(deployLogsDir()).toBe("");
    mount(" test/fixtures/deploy-logs/ ");
    expect(deployLogsDir()).toBe("test/fixtures/deploy-logs");
  });

  it("deployLogName keeps the base of the host path ringo recorded", () => {
    expect(deployLogName("/home/dean/.btwhooks/data/sessions/panes/12-1.log")).toBe("12-1.log");
  });

  it("readsDeployLogLocally needs a mount and a bare file name", () => {
    expect(readsDeployLogLocally("pane-12.log")).toBe(false);
    mount("test/fixtures/deploy-logs");
    expect(readsDeployLogLocally("pane-12.log")).toBe(true);
    expect(readsDeployLogLocally("..")).toBe(false);
  });

  it("readDeployLog reads raw, then gzipped, then names the missing path", async () => {
    mount("test/fixtures/deploy-logs");
    expect(await readDeployLog("pane-12.log")).toBe("-----> Building trailmap\n");
    expect(await readDeployLog("pane-13.log")).toBe("=====> Application deployed\n");
    expect(await readDeployLog("pane-99.log")).toBe(
      "(pane log unreadable: test/fixtures/deploy-logs/pane-99.log: no such file or directory)",
    );
  });

  it("deployLogPath names the file only when ringo recorded one", () => {
    expect(DeploysHelper.deployLogPath({ id: "a b" })).toBe("/deploys/log?id=a%20b");
    expect(DeploysHelper.deployLogPath({ id: "x", logFile: "/p/12-1.log" })).toBe("/deploys/log?id=x&file=12-1.log");
  });
});
