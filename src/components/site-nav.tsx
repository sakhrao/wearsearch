"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Search", match: "/" },
  { href: "/#discover", label: "Discover", match: undefined },
  { href: "/build", label: "Build", match: "/build" },
  { href: "/outfit", label: "Outfits", match: "/outfit" },
] as const;

function isActive(pathname: string, match?: string): boolean {
  if (!match) {
    return false;
  }
  if (match === "/") {
    return pathname === "/";
  }
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.match);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`relative px-4 py-2 text-sm font-medium transition ${
                active
                  ? "text-ink"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {link.label}
              {active && (
                <span className="absolute inset-x-4 bottom-0.5 h-px bg-ink" />
              )}
            </Link>
          );
        })}

        <Link
          href="/find"
          className="ml-3 rounded-full border border-ink bg-ink px-5 py-2 text-sm font-medium text-paper transition hover:bg-paper hover:text-ink"
        >
          Find your match
        </Link>
      </nav>

      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle menu"
          className="grid size-10 place-items-center border border-line bg-surface text-ink transition hover:border-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            className="size-5"
            aria-hidden="true"
          >
            {open ? (
              <>
                <path d="M6 6l12 12M18 6 6 18" />
              </>
            ) : (
              <>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-full z-40 border-b border-line bg-paper px-4 py-3 md:hidden"
        >
          <nav aria-label="Primary mobile" className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.match);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`border-l-2 px-4 py-3 text-base font-medium transition ${
                    active
                      ? "border-ink bg-paper-soft text-ink"
                      : "border-transparent text-ink-soft hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            <Link
              href="/find"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-full bg-ink px-5 py-3 text-center text-sm font-medium text-paper transition hover:bg-ink-soft"
            >
              Find your match
            </Link>
          </nav>
        </div>
      )}
    </>
  );
}