import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasRealProductPage } from "@/lib/product-url";
import { isDemoSource } from "@/lib/discovery";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const slug = request.nextUrl.searchParams.get("slug");
  const row = await prisma.product.findFirst({
    where: {
      ...(id ? { id } : { category: { slug: slug ?? "" } }),
      availability: "AVAILABLE",
    },
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      productUrl: true,
      imageUrl: true,
      createdAt: true,
      source: { select: { name: true, type: true, priority: true } },
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
  });

  if (!row) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    id: row.id,
    name: row.name,
    slug: row.category.slug,
    imageUrl: !!row.imageUrl,
    hasRealProductPage: hasRealProductPage(row.productUrl),
    isDemoSource: isDemoSource(row.source.name, row.source.type),
    sourceName: row.source.name,
    sourceType: row.source.type,
    priority: row.source.priority,
    brand: row.brand.name,
    productUrl: row.productUrl,
    price: Number(row.price),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  });
}