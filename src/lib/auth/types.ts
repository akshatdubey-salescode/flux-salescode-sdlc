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
