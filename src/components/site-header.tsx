import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export function SiteHeader() {
  return (
    <header className="relative z-40 border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          aria-label="FitWear — home"
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
              className="size-5 text-accent-deep"
            >
              {/* Hanger mark */}
              <path d="M12 4.2a1.5 1.5 0 1 1 1.5 1.5A1.5 1.5 0 0 1 12 5.7v0Z" />
              <path d="M12 6v4.4" />
              <path d="M7.5 20.2c1.2-1 3.1-1.5 4.5-1.5s3.3.5 4.5 1.5" />
              <path d="M4.3 12.4 12 6.6l7.7 5.8" />
              {/* Measuring tape */}
              <path d="M14.6 15.4a5.4 5.4 0 1 0 1.4 3.4" opacity="0.85" />
              <path d="M14.8 16.2v2.6M16 15.6v2.6M17.2 15.6v2.6" opacity="0.85" />
            </svg>
          </span>
          <span className="font-display text-xl font-medium tracking-tight text-ink">
            FitWear
          </span>
        </Link>

        <SiteNav />
      </div>
    </header>
  );
}