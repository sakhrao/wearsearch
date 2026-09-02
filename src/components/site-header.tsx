import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export function SiteHeader() {
  return (
    <header className="relative z-40 border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          aria-label="WearSearch — home"
          className="flex items-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg border border-line bg-surface shadow-sm"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              className="size-5 text-accent"
            >
              {/* Minimal hanger mark */}
              <path d="M12 4.2a1.5 1.5 0 1 1 1.5 1.5A1.5 1.5 0 0 1 12 5.7v0Z" />
              <path d="M9.4 8.6h5.2a2.6 2.6 0 1 1-1.8 4.5l-2 2H19" opacity="0" />
              <path d="M12 6v4.4" />
              <path d="M7.5 20.2c1.2-1 3.1-1.5 4.5-1.5s3.3.5 4.5 1.5" />
              <path d="M4.3 12.4 12 6.6l7.7 5.8" />
            </svg>
          </span>
          <span className="font-display text-xl font-medium tracking-tight text-ink">
            WearSearch
          </span>
        </Link>

        <SiteNav />
      </div>
    </header>
  );
}