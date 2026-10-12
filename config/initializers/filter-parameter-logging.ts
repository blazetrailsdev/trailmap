// Be sure to restart your server when you modify this file.

import { Trails } from "@blazetrails/trailties";

// Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
// Use this to limit dissemination of sensitive information.
// See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Trails.application!.config.filterParameters = Trails.application!.config.filterParameters.concat([
  "passw", "email", "secret", "token", "_key", "crypt", "salt", "certificate", "otp", "ssn", "cvv", "cvc",
]);
