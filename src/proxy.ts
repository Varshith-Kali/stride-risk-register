/**
 * Next.js Edge Proxy — per-request security hardening.
 *
 * In Next.js 16+, this file is named "proxy.ts" and MUST export a function
 * named "proxy" (replaces the old "middleware.ts" / "middleware" convention).
 *
 * Responsibilities:
 *   1. Generate a cryptographic nonce for every HTML page response.
 *   2. Thread the nonce into the Content-Security-Policy header so that
 *      Next.js inline scripts are allowlisted by nonce rather than
 *      the blanket 'unsafe-inline' keyword.
 *   3. Expose the nonce via x-nonce request header so layout.tsx can
 *      read it during SSR.
 *
 * Security note:
 *   A nonce-based CSP is strictly stronger than 'unsafe-inline':
 *   - Each nonce is a random, single-use 16-byte value (base64-encoded).
 *   - An attacker who injects a <script> tag cannot know the nonce —
 *     their script is blocked even without 'unsafe-inline'.
 *   We retain 'unsafe-inline' only as a fallback for very old browsers
 *   (IE11 / ancient Safari). Modern browsers honour the nonce and ignore
 *   'unsafe-inline' when a valid nonce is present (per CSP Level 2 spec).
 */

import { NextResponse, type NextRequest } from "next/server";

export const config = {
  /**
   * Run on every route EXCEPT:
   *   - Static files: /_next/static/
   *   - Image optimisation: /_next/image
   *   - Public assets: favicon, icon, robots, sitemap
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.|robots\\.txt|sitemap\\.xml).*)",
  ],
};

/**
 * Next.js 16 proxy handler.
 * MUST be exported as "proxy" — this is the new convention enforced by Next.js 16.
 */
export function proxy(req: NextRequest): NextResponse {
  // 1. Generate a cryptographic nonce — 16 random bytes, base64-encoded.
  //    Unique and unpredictable per request.
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16))
  ).toString("base64");

  // 2. Build the nonce-hardened Content-Security-Policy.
  const csp = [
    "default-src 'self'",
    // Nonce explicitly allowlists Next.js runtime inline scripts.
    // 'unsafe-inline' is a fallback for browsers that don't support nonces;
    // modern browsers ignore it when a nonce is present (CSP Level 2+).
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // connect-src: browser never contacts OpenAI — all LLM calls are
    // server-side via Next.js API routes. 'self' is sufficient.
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // 3. Inject the nonce into the request headers so layout.tsx can read
  //    it server-side during SSR to set nonce on rendered script tags.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // 4. Set the CSP response header.
  res.headers.set("Content-Security-Policy", csp);

  // 5. Set a per-request trace ID — lets users report issues precisely
  //    without exposing server internals. Logged at the app layer.
  res.headers.set("X-Request-ID", crypto.randomUUID());

  return res;
}
