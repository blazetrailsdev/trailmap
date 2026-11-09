import type { MessageDelivery } from "@blazetrails/actionmailer";
import type { MissingCompareData } from "../../lib/stats-sync/missing-compare-data.ts";
import { ApplicationMailer } from "./application-mailer.ts";

/** What a finished `StatsSyncJob` run reports. A failed run is `OpsMailer#jobFailed`'s. */
export class StatsSyncMailer extends ApplicationMailer {
  // The class-level action call Base's methodMissing answers; untyped until
  // actionmailer-smtp-settings-typed-and-railtie.
  declare static missingCompareData: (report: { to: string; packages: MissingCompareData[] }) => MessageDelivery;

  /** The packages a finished sync left with "no data" tiles and no reason. */
  missingCompareData(report: { to: string; packages: MissingCompareData[] }): ReturnType<ApplicationMailer["mail"]> {
    const lines = report.packages.map((p) => `${p.package}: no ${p.missing.join(" or ")} rows`);
    return this.mail({
      to: report.to,
      from: report.to,
      subject: `[stats-sync] ${report.packages.length} ${report.packages.length === 1 ? "package has" : "packages have"} no compare data`,
      body: `These packages have a Rails counterpart, no rows under their compare keys, and no "Not in parity" reason:\n\n${lines.join("\n")}\n`,
    });
  }
}
