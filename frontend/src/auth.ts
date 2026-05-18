import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// To migrate to an external/self-hosted IdP later, add an OIDC provider here
// alongside (or instead of) CredentialsProvider — no other files need to change.
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      credentials: {
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const expected = process.env.AUTH_PASSWORD;
        if (expected && credentials?.password === expected) {
          return { id: "family", name: "Family" };
        }
        return null;
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
};
