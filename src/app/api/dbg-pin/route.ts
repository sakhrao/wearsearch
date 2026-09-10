import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSpotlightCategories } from "@/lib/discovery";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const rows = await prisma.product.findMany({
    where: {
      availability: "AVAILABLE",
      source: { type: { not: "DEMO" } },
    },
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      productUrl: true,
      imageUrl: true,
      createdAt: true,
      source: { select: { name: true, type: true } },
      brand: { select: { name: true } },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parent: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const pinnedMatches = rows.filter(
    (p) =>
      (id && p.id === id) ||
      (p.productUrl ?? "").includes("256468968056")
  );

  const spotlight = await getSpotlightCategories();
  const tshirts = spotlight.find((s) => s.slug === "t-shirts") ?? null;

  return NextResponse.json({
    totalRows: rows.length,
    pinnedMatches: pinnedMatches.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.category.slug,
      imageUrl: !!p.imageUrl,
      sourceName: p.source.name,
      sourceType: p.source.type,
      urlHasItem: (p.productUrl ?? "").includes("256468968056"),
      createdAt: p.createdAt.toISOString(),
    })),
    tshirts,
  });
}