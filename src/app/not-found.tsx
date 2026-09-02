import Link from "next/link";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center bg-paper text-ink">
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
          404
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-4 text-ink-soft">
          We couldn&apos;t find that page. Head back to search to find
          exactly what you&apos;re looking for.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-white transition hover:bg-accent-deep"
          >
            Back to search
          </Link>
          <Link
            href="/outfit"
            className="rounded-full border border-line bg-surface px-7 py-3 text-sm font-medium text-ink-soft transition hover:border-accent/50 hover:text-accent"
          >
            Build an outfit
          </Link>
        </div>
      </div>
    </main>
  );
}