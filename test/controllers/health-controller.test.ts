import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { HealthController } from "../../app/controllers/health-controller.js";

describe("HealthController", () => {
  it("answers ok", async () => {
    const tc = new ActionController.TestCase(HealthController);
    await tc.get("show");

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.responseBody)).toEqual({ status: "ok" });
  });
});
