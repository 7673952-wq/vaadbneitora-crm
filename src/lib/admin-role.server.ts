// Deprecated: re-exports from the unified permissions module.
// New code should import from `@/lib/permissions.server` directly.
export {
  isAdminUserId,
  isSuperAdminUserId,
  assertAdminUserId,
  assertSuperAdminUserId,
} from "@/lib/permissions.server";
