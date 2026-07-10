import withAuth from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  // Protect every route except the login page, NextAuth's own API routes,
  // Next.js static assets, and the one-time seed endpoint (which has its
  // own token-based check instead of a session, since it must run before
  // any user account can log in). Uploaded files are served through an
  // authenticated route handler, never from a public /public directory
  // (section 25: "geen publieke toegang tot uploads").
  matcher: ["/((?!login|api/auth|api/admin/seed|_next/static|_next/image|favicon.ico).*)"],
};
