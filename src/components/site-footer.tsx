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
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <p className="font-display text-xl font-medium tracking-tight text-ink">
            FitWear
          </p>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-soft">
            Premium fashion discovery. Describe the piece, find the match.
          </p>
        </div>

        <nav aria-label="Explore" className="sm:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Explore
          </p>
          <ul className="mt-5 space-y-3 text-sm">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-ink-soft transition hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Information" className="sm:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Information
          </p>
          <ul className="mt-5 space-y-3 text-sm">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-ink-soft transition hover:text-ink"
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
          © {new Date().getFullYear()} FitWear.{" "}
          Find the pieces that feel like you.
        </div>
      </div>
    </footer>
  );
}