import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How WearSearch handles your data.",
};

export default function PrivacyPage() {
  return (
    <StaticPage eyebrow="Legal" title="Privacy">
      <section>
        <h2 className="text-base font-semibold text-ink">
          What we collect
        </h2>
        <p className="mt-2">
          WearSearch is a clothing search tool. It does not require an
          account, and it does not collect or store personally
          identifiable information about its visitors.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">
          Demo and real data
        </h2>
        <p className="mt-2">
          Searches run against a catalog of real products. Product
          pages you open belong to their respective stores, which have
          their own privacy policies.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-ink">
          Local data
        </h2>
        <p className="mt-2">
          Anything stored in your browser (for example, in-progress
          questionnaire answers) stays on your device and is never sent
          to us.
        </p>
      </section>
    </StaticPage>
  );
}