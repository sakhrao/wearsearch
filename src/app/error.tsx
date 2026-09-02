"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("WearSearch error boundary:", error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center bg-paper text-ink">
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
          Something went wrong
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight">
          We couldn&apos;t finish that
        </h1>
        <p className="mt-4 text-ink-soft">
          An unexpected error interrupted the page. You can retry, or
          head back to a fresh search.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-white transition hover:bg-accent-deep"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full border border-line bg-surface px-7 py-3 text-sm font-medium text-ink-soft transition hover:border-accent/50 hover:text-accent"
          >
            Back to search
          </Link>
        </div>
      </div>
    </main>
  );
}