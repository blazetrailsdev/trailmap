import { Base } from "@blazetrails/actionmailer";
import { env } from "@blazetrails/ruby-compat";

/**
 * Delivery goes over SMTP to `SMTP_ADDRESS` (the relay the host's msmtp used,
 * docs/deploy.md). Set on the class rather than as `config.actionMailer`:
 * trails ships no action_mailer railtie to read that config.
 */
export class ApplicationMailer extends Base {
  static {
    (this as unknown as { smtpSettings: Record<string, unknown> }).smtpSettings = {
      address: env.SMTP_ADDRESS ?? "localhost",
      port: Number(env.SMTP_PORT ?? 587),
      userName: env.SMTP_USER_NAME ?? null,
      password: env.SMTP_PASSWORD ?? null,
      authentication: env.SMTP_USER_NAME ? "plain" : null,
      enableStarttlsAuto: true,
    };
  }
}
