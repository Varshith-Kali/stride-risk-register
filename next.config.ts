import type { NextConfig } from "next";

const securityHeaders = [
  // ── Prevent MIME-type sniffing ───────────────────────────────────────────
  { key: "X-Content-Type-Options", value: "nosniff" },

  // ── Clickjacking protection ──────────────────────────────────────────────
  { key: "X-Frame-Options", value: "DENY" },

  // ── XSS filter (legacy browsers) ────────────────────────────────────────
  { key: "X-XSS-Protection", value: "1; mode=block" },

  // ── Strict referrer — never leak URL to third parties ───────────────────
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // ── Disable unnecessary browser features ────────────────────────────────
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  // ── HSTS — enforce HTTPS for 1 year including subdomains ─────────────────
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },

  // ── Cross-Origin isolation (Spectre / side-channel mitigation) ───────────
  // COOP: prevents other windows from acquiring a reference to this window.
  { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
  // COEP: credentialless is less strict than require-corp but still prevents
  // Spectre-style side-channel attacks against cross-origin resources.
  // require-corp breaks cross-origin fonts/scripts that lack CORP headers.
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
  // CORP: prevents other origins from reading this resource.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },

  // NOTE: Content-Security-Policy is intentionally NOT set here.
  // It is generated per-request with a fresh cryptographic nonce in
  // src/proxy.ts. A static CSP here would override the nonce-based one
  // on some routes, defeating the nonce-based XSS mitigation.
];

const nextConfig: NextConfig = {
  // ── Security ──────────────────────────────────────────────────────────────
  reactStrictMode: true,

  typescript: {
    ignoreBuildErrors: false,
  },

  // Hide the Next.js dev-mode floating indicator.
  devIndicators: false,

  // HTTP security headers on every route.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
