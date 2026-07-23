export const UserRole = {
  USER: "USER",
  ADMIN: "ADMIN",
  SUPERUSER: "SUPERUSER",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  USER: 0,
  ADMIN: 1,
  SUPERUSER: 2,
};

/** Returns true if `role` meets or exceeds `required` */
export function hasMinRole(role: UserRole, required: UserRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
}

/**
 * Gates delivery-tracker management (create/edit/delete a delivery, add/
 * remove items) — ADMINs always qualify; a plain USER qualifies only if
 * explicitly granted via the Superuser "Delivery Managers" tool. This is
 * the one place that OR is ever evaluated — every route/UI gate calls this
 * rather than re-deriving it.
 */
export function canManageDeliveries(user: { role: UserRole; canManageDeliveries: boolean }): boolean {
  return hasMinRole(user.role, "ADMIN") || user.canManageDeliveries === true;
}
