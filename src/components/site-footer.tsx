import Link from "next/link";

const EXPLORE_LINKS = [
  { href: "/", label: "Search" },
  { href: "/#discover", label: "Discover" },
  { href: "/outfit", label: "Outfits" },
  { href: "/#how-it-works", label: "How it works" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-soft">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-3">
        <div>
          <p className="font-display text-lg font-medium tracking-tight text-ink">
            WearSearch
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-soft">
            Find what fits your style.
          </p>
        </div>

        <nav aria-label="Explore">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Explore
          </p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-ink-soft transition hover:text-accent"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Information">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Information
          </p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-ink-soft transition hover:text-accent"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-ink-faint">
          © {new Date().getFullYear()} WearSearch.{" "}
          Find the pieces that feel like you.
        </div>
      </div>
    </footer>
  );
}