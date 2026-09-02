import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the WearSearch project.",
};

export default function ContactPage() {
  return (
    <StaticPage eyebrow="Contact" title="Contact">
      <section>
        <h2 className="text-base font-semibold text-ink">
          Get in touch
        </h2>
        <p className="mt-2">
          WearSearch is an independent project. For feedback, catalog
          corrections, or store inquiries, email{" "}
          <a
            href="mailto:hi@wearsearch.example"
            className="font-medium text-accent underline underline-offset-4"
          >
            hi@wearsearch.example
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">
          Before you write
        </h2>
        <p className="mt-2">
          Price and stock questions about a specific item are best
          answered by the store that sells it — check the product
          page first.
        </p>
      </section>
    </StaticPage>
  );
}