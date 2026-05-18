import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  // Protect all routes except static assets, auth API, health probe, and login page.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/health|login).*)"],
};
