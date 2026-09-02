import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms that apply when you use WearSearch.",
};

export default function TermsPage() {
  return (
    <StaticPage eyebrow="Legal" title="Terms">
      <section>
        <h2 className="text-base font-semibold text-ink">
          What this is
        </h2>
        <p className="mt-2">
          WearSearch is a search engine for clothing. It aggregates
          products from real stores so you can find them with plain-
          language queries. It is not an online store and does not
          process payments.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">
          Product accuracy
        </h2>
        <p className="mt-2">
          Product names, prices, and availability reflect the catalog
          at indexing time and can change. Always confirm price,
          stock, and delivery on the store&apos;s own product page
          before purchasing.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">
          Links to stores
        </h2>
        <p className="mt-2">
          When you open a product page, you are leaving WearSearch.
          The stores linked from the catalog are responsible for their
          own content, pricing, and transactions.
        </p>
      </section>
    </StaticPage>
  );
}