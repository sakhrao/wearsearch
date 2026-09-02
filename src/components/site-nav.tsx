"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Search", match: "/" },
  { href: "/#discover", label: "Discover", match: undefined },
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
      <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.match);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                active
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-paper-soft hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}

        <Link
          href="/find"
          className="ml-3 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-deep"
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
          className="grid size-10 place-items-center rounded-lg border border-line bg-surface text-ink transition hover:border-ink"
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
                  className={`rounded-lg px-4 py-3 text-base font-medium transition ${
                    active
                      ? "bg-ink text-paper"
                      : "text-ink-soft hover:bg-paper-soft hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}