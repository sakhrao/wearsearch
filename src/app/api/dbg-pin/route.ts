import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSpotlightCategories } from "@/lib/discovery";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const slug = request.nextUrl.searchParams.get("slug");
  const row = await prisma.product.findFirst({
    where: {
      ...(id ? { id } : { category: { slug: slug ?? "" } }),
      availability: "AVAILABLE",
    },
  });

  const spotlight = await getSpotlightCategories();
  const tshirts = spotlight.find((s) => s.slug === "t-shirts") ?? null;

  return NextResponse.json({
    pinnedExists: !!row,
    pinnedId: row?.id ?? null,
    pinnedName: row?.name ?? null,
    pinnedUrl: row?.productUrl ?? null,
    spotlightCount: spotlight.length,
    sliderSlugs: spotlight.map((s) => s.slug),
    tshirts,
  });
}