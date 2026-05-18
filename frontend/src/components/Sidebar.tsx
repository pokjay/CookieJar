"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { CookieJarLogo, CookieMark } from "@/components/brand/CookieJarLogo";
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  Plane,
  Tag,
  Building2,
  PlusCircle,
  Settings,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Landmark,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";

const navItems = [
  { href: "/", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { href: "/cash-flow", label: "Cash Flow", shortLabel: "Cash Flow", icon: TrendingUp },
  { href: "/investments", label: "Investments", shortLabel: "Invest.", icon: Landmark },
  { href: "/transactions", label: "Transactions", shortLabel: "Transact.", icon: Receipt },
  { href: "/travel", label: "Travel", shortLabel: "Travel", icon: Plane },
  { href: "/category-mapping", label: "Category Mapping", shortLabel: "Categories", icon: Tag },
  { href: "/business-mapping", label: "Business Mapping", shortLabel: "Businesses", icon: Building2 },
  { href: "/manual-transactions", label: "Manual Transactions", shortLabel: "Manual", icon: PlusCircle },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

const primaryItems = navItems.slice(0, 4);
const moreItems = navItems.slice(4);

export default function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const logoTheme = mounted ? (resolvedTheme === "dark" ? "dark" : "light") : "dark";
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("sidebar-collapsed", String(!c));
      return !c;
    });
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          "hidden lg:flex flex-col h-full bg-cj-surface border-r border-cj-border",
          "transition-[width] duration-200 ease-in-out flex-shrink-0",
          collapsed ? "w-16" : "w-60",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center h-14 px-4 border-b border-cj-border flex-shrink-0">
          {collapsed ? (
            <CookieMark theme={logoTheme} size={28} />
          ) : (
            <CookieJarLogo theme={logoTheme} size="sm" />
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={[
                  "flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-cj-accent/20 text-cj-accent-text"
                    : "text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated",
                ].join(" ")}
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Logout + collapse toggle */}
        <div className="border-t border-cj-border p-2 flex items-center justify-between">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="p-2 rounded-lg text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated"
          >
            <LogOut size={16} />
          </button>
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-2 rounded-lg text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated"
              title="Collapse sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-2 rounded-lg text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated"
              title="Expand sidebar"
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <div className="lg:hidden">
        {/* "More" popup */}
        {moreOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setMoreOpen(false)}
            />
            <div className="fixed bottom-16 right-0 z-40 bg-cj-surface border border-cj-border rounded-tl-xl shadow-xl w-52 py-2">
              {moreItems.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={[
                      "flex items-center gap-3 px-4 py-3 text-sm transition-colors",
                      active ? "text-cj-accent-text" : "text-cj-text-3 hover:text-cj-text hover:bg-cj-elevated",
                    ].join(" ")}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-cj-text-muted hover:text-cj-text hover:bg-cj-elevated transition-colors"
              >
                <LogOut size={18} className="flex-shrink-0" />
                <span>Sign out</span>
              </button>
            </div>
          </>
        )}

        <nav className="fixed bottom-0 left-0 right-0 z-30 bg-cj-surface border-t border-cj-border flex">
          {primaryItems.map(({ href, shortLabel, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors",
                  active ? "text-cj-accent-text" : "text-cj-text-faint hover:text-cj-text-3",
                ].join(" ")}
              >
                <Icon size={20} className="flex-shrink-0" />
                <span className="truncate w-full text-center px-0.5">{shortLabel}</span>
              </Link>
            );
          })}
          {/* More button */}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={[
              "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors",
              moreOpen || moreItems.some(({ href }) => pathname.startsWith(href))
                ? "text-cj-accent-text"
                : "text-cj-text-faint hover:text-cj-text-3",
            ].join(" ")}
          >
            <MoreHorizontal size={20} />
            <span>More</span>
          </button>
        </nav>
      </div>
    </>
  );
}
