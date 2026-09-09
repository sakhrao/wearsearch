/* Reusable editorial section heading: small uppercase eyebrow,
   display serif title, optional description. Left-aligned by
   default (asymmetric, editorial); center available. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  const alignment =
    align === "center"
      ? "mx-auto max-w-2xl text-center"
      : "max-w-2xl";

  return (
    <div className={alignment}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl"
      >
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-ink-soft">
          {description}
        </p>
      )}
    </div>
  );
}