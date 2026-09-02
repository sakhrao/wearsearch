/* Shared layout for lightweight, honest static pages
   (Privacy / Terms / Contact). No fabrication: copy stays
   factual about what WearSearch actually is and does. */

export function StaticPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex-1 bg-paper text-ink">
      <article className="mx-auto max-w-2xl px-6 py-16 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight">
          {title}
        </h1>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-ink-soft">
          {children}
        </div>
      </article>
    </main>
  );
}