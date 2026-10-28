import { describe, expect, it } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { INVALID_PR, integerParam, presentParam, prRefParam } from "../../../app/controllers/concerns/api-params.ts";

const params = (values: Record<string, unknown>) => new ActionController.Parameters(values);

describe("presentParam", () => {
  it("reads a present value as a string, and blank or absent as undefined", () => {
    const p = params({ rfc: "0136", n: 7, blank: "", spaces: "  " });
    expect(presentParam(p, "rfc")).toBe("0136");
    expect(presentParam(p, "n")).toBe("7");
    expect(presentParam(p, "blank")).toBeUndefined();
    expect(presentParam(p, "spaces")).toBeUndefined();
    expect(presentParam(p, "missing")).toBeUndefined();
  });
});

describe("integerParam", () => {
  it("reads leading digits, and anything else as undefined", () => {
    const p = params({ a: "250", b: "12abc", c: "abc" });
    expect(integerParam(p, "a")).toBe(250);
    expect(integerParam(p, "b")).toBe(12);
    expect(integerParam(p, "c")).toBeUndefined();
    expect(integerParam(p, "missing")).toBeUndefined();
  });
});

describe("prRefParam", () => {
  it("normalises repo#N, refuses a malformed ref, and reads absent as null", () => {
    expect(prRefParam(params({ pr: " trails#7228 " }), "pr")).toBe("trails#7228");
    for (const bad of ["7", "trails#07", "trails#7abc"]) expect(prRefParam(params({ pr: bad }), "pr")).toBe(INVALID_PR);
    expect(prRefParam(params({}), "pr")).toBeNull();
    expect(prRefParam(params({ pr: "" }), "pr")).toBeNull();
  });
});
