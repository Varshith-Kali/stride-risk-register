import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// ─── Fonts (same as STRIDE GPT — product-suite parity) ────────────────────────
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

// ─── SEO Metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "STRIDE Risk Register — ISG Security Architecture",
  description:
    "Governed, ranked, visual risk register for the ISG Security Architecture team. Turns STRIDE GPT threat-model exports and reviewer recommendations into a traceable portfolio of risks.",
  keywords: [
    "STRIDE",
    "risk register",
    "threat modeling",
    "security architecture",
    "DREAD",
    "governance",
    "cybersecurity",
  ],
  authors: [{ name: "ISG Security Architecture" }],
  openGraph: {
    title: "STRIDE Risk Register — ISG Security Architecture",
    description:
      "Governed, ranked, visual risk register. Every risk traceable to its source.",
    type: "website",
  },
};

// ─── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        {children}
        {/* Sonner toast notifications — the only toast system in use. */}
        <Toaster />
      </body>
    </html>
  );
}
