import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260730160000_normalize_customer_actor_references.sql",
  import.meta.url,
);
const renewalMigrationUrl = new URL(
  "../supabase/migrations/20260722120000_safe_crm_contract_cycles.sql",
  import.meta.url,
);
const auditMigrationUrl = new URL(
  "../supabase/migrations/20260725194000_fix_operational_revision_action_case.sql",
  import.meta.url,
);

const [migration, renewalMigration, auditMigration] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(renewalMigrationUrl, "utf8"),
  readFile(auditMigrationUrl, "utf8"),
]);

assert.match(
  renewalMigration,
  /updated_by\s*=\s*auth\.uid\(\)/i,
  "Regression fixture must keep exercising the formal renewal write that supplied auth.uid().",
);
assert.match(
  migration,
  /before\s+insert\s+or\s+update\s+of\s+created_by,\s*updated_by\s+on\s+public\.customers/i,
  "Every customer write must pass through the shared actor-reference boundary.",
);
assert.match(
  migration,
  /where\s+auth_user_id\s*=\s*new\.updated_by[\s\S]*status\s*=\s*'active'/i,
  "An auth.users id must be mapped to the active app_users id before the FK check.",
);
assert.match(
  migration,
  /new\.updated_by\s*:=\s*mapped_app_user_id/i,
  "A missing app_users mapping must safely become null instead of rejecting the renewal.",
);
assert.match(
  migration,
  /security\s+definer/i,
  "The normalizer must be able to read app_users even when authenticated RLS/grants are restrictive.",
);
assert.match(
  auditMigration,
  /actor_auth_id[\s\S]*auth\.uid\(\)/i,
  "The authenticated actor must remain recorded in the append-only audit log.",
);
assert.doesNotMatch(
  migration,
  /\bV?17\b|customer_no\s*=/i,
  "The fix must not special-case V17 or any customer number.",
);

console.log("crm-renewal-actor-fk-regression: PASS");
