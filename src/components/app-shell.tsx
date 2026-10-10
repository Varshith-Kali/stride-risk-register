"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  History,
  ScrollText,
  KeyRound,
  Menu,
  Plus,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BrandMark } from "@/components/brand-mark";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { cn } from "@/lib/utils";

/**
 * Agent D — application shell (canonical version): sidebar nav + sticky top
 * bar. The session ApiKeyProvider lives in the root layout (not here), so the
 * OpenAI key set in the top bar persists across client navigation.
 *
 * Theme parity with STRIDE GPT: `.navbar-solid` top bar, lucide icons only,
 * light theme, no ThemeProvider. Mobile: sidebar collapses to a Sheet.
 */

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timeline", label: "Timeline", icon: History },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/reviewers", label: "Reviewers", icon: Users },
  { href: "/audit", label: "Audit", icon: ScrollText },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="navbar-solid sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BrandMark className="h-5 w-5" mono />
            </span>
            <span className="leading-tight">
              <span className="text-eyebrow block text-muted-foreground">
                STRIDE · ISG Security Architecture
              </span>
              <span className="block text-base font-semibold tracking-tight">
                Risk Register
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKeyDialogOpen(true)}
              className="hidden sm:inline-flex"
              aria-label="Set OpenAI API key"
              title="Set OpenAI API key (session only)"
            >
              <KeyRound className="h-4 w-4" />
              <span className="hidden lg:inline">API key</span>
            </Button>
            <Button size="sm" onClick={() => router.push("/")}>
              <Plus className="h-4 w-4" />
              New Submission
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1">
        {/* ── Desktop sidebar ───────────────────────────────────── */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-border md:block">
          <NavList />
        </aside>

        {/* ── Mobile sidebar (Sheet) ────────────────────────────── */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BrandMark className="h-4 w-4" mono />
                </span>
                <span className="text-sm font-semibold">Risk Register</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <NavList onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* ── Page content ──────────────────────────────────────── */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="fade-in">{children}</div>
        </main>
      </div>

      <ApiKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <ShellInner>{children}</ShellInner>;
}
