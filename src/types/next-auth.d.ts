import "next-auth";
import "next-auth/jwt";
import type { UserRole } from "@/lib/auth/types";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    role?: UserRole;
  }
}
