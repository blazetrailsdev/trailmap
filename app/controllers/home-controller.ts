import { ConnectionNotDefined } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.ts";
import { Owner } from "../models/owner.ts";

export class HomeController extends ApplicationController {
  /**
   * The landing page. It lists the hub's owners, so the owner/repository
   * hierarchy is reachable without knowing an organization's name — the one
   * thing `/:owner` cannot advertise about itself.
   *
   * A process with no hub connection (the suite, mostly) gets an empty list
   * rather than an error: this page reads a row it does not need, and it was
   * answering `/` long before the hub existed.
   *
   * `ConnectionNotDefined` is specifically "no pool was established", never
   * "the database is misconfigured" — a wrong URL or a down server raises a
   * connection error and 500s from here. `Setting.findByKey` carries the full
   * argument, including why `HUB_DATABASE_URL` is the wrong thing to test.
   */
  async index(): Promise<void> {
    await this.render({ locals: { owners: await ownersOrNone() } });
  }
}

async function ownersOrNone(): Promise<Owner[]> {
  try {
    return await Owner.order("login").toArray();
  } catch (error) {
    if (error instanceof ConnectionNotDefined) return [];
    throw error;
  }
}
