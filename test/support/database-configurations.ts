import { Base } from "@blazetrails/activerecord";
import databaseConfig from "../../config/database.ts";

/**
 * What `active_record.initialize_database` does at boot, before any model is
 * imported: `Hub` and `Stats` call `connectsTo` when their class is defined,
 * and that resolves against `Base.configurations`. The suite imports models
 * without booting, so this sets them first (vitest.config.ts `setupFiles`).
 */
Base.configurations(databaseConfig);
