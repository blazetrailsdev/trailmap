/**
 * Thrown by a mutation that has decided its outcome and the exit code to carry.
 *
 * EXIT CODES are a contract with btwhooks and the agent skills, preserved
 * exactly from the CLI (src/db.ts):
 *   0  success, including an idempotent repeat
 *   2  benign conflict — "someone else holds it, pick another story"
 *   3  lost claim race
 *   1  real error
 *
 * The model raises with the CLI's refusal text as the message rather than
 * printing it: the model decides, the caller reports.
 */
export class VerbExit extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "VerbExit";
  }
}
