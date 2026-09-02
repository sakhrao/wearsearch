export default function Loading() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16 text-center">
        <div className="mx-auto h-3 w-40 animate-pulse rounded-full bg-paper-soft" />
        <div className="mx-auto mt-6 h-14 w-2/3 animate-pulse rounded-2xl bg-paper-soft" />
        <div className="mx-auto mt-6 h-14 w-full animate-pulse rounded-2xl bg-paper-soft" />
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
          <div className="h-32 animate-pulse rounded-2xl bg-paper-soft" />
          <div className="h-32 animate-pulse rounded-2xl bg-paper-soft" />
        </div>
        <p className="sr-only">Finding your matches…</p>
      </div>
    </main>
  );
}