/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { Trails } from "@blazetrails/trailties";

const modules: Record<string, Record<string, unknown>> = import.meta.glob("../../app/controllers/*.ts", {
  eager: true,
});

function controllers(): (typeof ActionController.Base)[] {
  const found = new Set<typeof ActionController.Base>();
  for (const exports of Object.values(modules)) {
    for (const value of Object.values(exports)) {
      if (typeof value === "function" && value.prototype instanceof ActionController.Base) {
        found.add(value as typeof ActionController.Base);
      }
    }
  }
  return [...found];
}

function routedActions(): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  for (const route of Trails.application!.routes().routes()) {
    const { controller, action } = route.defaults;
    if (typeof controller !== "string" || typeof action !== "string") continue;
    if (!table.has(controller)) table.set(controller, new Set());
    table.get(controller)!.add(action);
  }
  return table;
}

describe("app/controllers", () => {
  it("lists only routed actions in each controller's actionMethods", () => {
    const routed = routedActions();
    const unrouted: string[] = [];
    const all = controllers();
    expect(all.length).toBeGreaterThan(20);
    for (const controller of all) {
      const actions = routed.get(controller.controllerPath()) ?? new Set<string>();
      for (const name of controller.actionMethods()) {
        if (!actions.has(name)) unrouted.push(`${controller.name}#${name}`);
      }
    }
    expect(unrouted).toEqual([]);
  });
});
