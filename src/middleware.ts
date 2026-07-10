import withAuth from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  // Protect every route except the login page, NextAuth's own API routes,
  // and Next.js static assets. Uploaded files are served through an
  // authenticated route handler, never from a public /public directory
  // (section 25: "geen publieke toegang tot uploads").
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
