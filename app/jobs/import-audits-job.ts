import { ApplicationJob } from "./application-job.ts";
import { Audit } from "../models/audit.ts";

/**
 * Copies the audit files agents have written since the last run into Active
 * Storage (`Audit.importFrom`). Scheduled in config/recurring.yml; a run with
 * nothing new reads the directory and writes nothing.
 */
export class ImportAuditsJob extends ApplicationJob {
  async perform(): Promise<void> {
    await Audit.importFrom();
  }
}
