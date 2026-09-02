import HomePage from "@/components/home-page";
import { getHomepageData } from "@/lib/discovery";

/* Readings come straight from the catalog on every visit so the
   homepage never shows stale counts/products after a re-sync. */
export const dynamic = "force-dynamic";

export default async function HomePageRoute() {
  const data = await getHomepageData();

  return (
    <HomePage categories={data.categories} featured={data.featured} />
  );
}