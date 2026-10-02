import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { HealthController } from "../../app/controllers/health-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * The rescue path is what makes `/up` mean "booted with no exceptions" rather
 * than "can route a request", so it needs a request that raises. A subclass
 * inherits the registered handler, which is the thing under test.
 */
class FailingHealthController extends HealthController {
  override async show(): Promise<void> {
    throw new Error("boot incomplete");
  }
}

describe("HealthController", () => {
  it("answers ok", async () => {
    const tc = await controllerTestCase(HealthController);
    await tc.get("show");

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.response.body)).toEqual({ status: "ok" });
  });

  it("answers 500 when the action raises", async () => {
    const tc = await controllerTestCase(FailingHealthController);
    await tc.get("show");

    expect(tc.response.status).toBe(500);
    expect(JSON.parse(tc.response.body)).toEqual({ status: "down" });
  });
});
