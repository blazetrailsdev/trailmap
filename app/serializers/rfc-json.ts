/**
 * The RFC object `index.json` carries, reproduced field for field.
 *
 * Same contract as story-json.ts and for the same reason: ringo unmarshals
 * these rows into its `rfc` struct (spawnloop.go) to render the RFC pages and
 * the burndown, so adding, renaming or reordering a field here is a cross-repo
 * break. The JSON-array columns are stored as text by `ingest`, which is why
 * they are parsed here rather than being handed through — a consumer reading
 * `packages` expects a list, not the string `["activerecord"]`.
 */
import type { Rfc } from "../models/index.js";
import { jsonArrayColumn } from "../models/rfc.js";
import { isoMidnight, integerOrNull } from "./story-json.js";

export interface RfcJson {
  id: string;
  title: string | null;
  status: string | null;
  priority: number | null;
  owner: string | null;
  created: string | null;
  updated: string | null;
  packages: string[];
  clusters: string[];
  superseded_by: string | null;
  related_rfcs: string[];
  file_path: string | null;
}

export function serializeRfc(rfc: Rfc): RfcJson {
  return {
    id: rfc.id,
    title: rfc.title ?? null,
    status: rfc.status ?? null,
    priority: integerOrNull(rfc.priority),
    owner: rfc.owner ?? null,
    created: isoMidnight(rfc.created_on),
    updated: isoMidnight(rfc.updated_on),
    packages: jsonArrayColumn(rfc.packages),
    clusters: jsonArrayColumn(rfc.clusters),
    superseded_by: rfc.superseded_by ?? null,
    related_rfcs: jsonArrayColumn(rfc.related_rfcs),
    file_path: rfc.file_path ?? null,
  };
}

export function serializeRfcs(rfcs: Rfc[]): RfcJson[] {
  return rfcs.map(serializeRfc);
}
