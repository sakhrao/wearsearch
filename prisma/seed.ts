import "dotenv/config";

import {
  PrismaClient,
  SourceType,
  SourceStatus,
  Availability,
  Gender,
  SizeSystem,
  AttributeType,
} from "../src/generated/prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  console.log("🌱 Starting database seed...");

  // ==========================================
  // SOURCES
  // ==========================================

  const demoSource = await prisma.source.upsert({
    where: {
      name: "WearSearch Demo Store",
    },
    update: {},
    create: {
      name: "WearSearch Demo Store",
      type: SourceType.DEMO,
      baseUrl: "https://example.com",
      status: SourceStatus.ACTIVE,
    },
  });

  // ==========================================
  // BRANDS
  // ==========================================

  const brandNames = [
    "Nike",
    "Adidas",
    "Puma",
    "Zara",
    "H&M",
    "New Balance",
  ];

  const brands: Record<string, any> = {};

  for (const name of brandNames) {
    brands[name] = await prisma.brand.upsert({
      where: {
        name,
      },
      update: {},
      create: {
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        websiteUrl: `https://example.com/${name.toLowerCase()}`,
      },
    });
  }

  // ==========================================
  // CATEGORIES
  // ==========================================

  const clothing = await prisma.category.upsert({
    where: {
      slug: "clothing",
    },
    update: {},
    create: {
      name: "Clothing",
      slug: "clothing",
    },
  });

  const tops = await prisma.category.upsert({
    where: {
      slug: "tops",
    },
    update: {},
    create: {
      name: "Tops",
      slug: "tops",
      parentId: clothing.id,
    },
  });

  const shirts = await prisma.category.upsert({
    where: {
      slug: "shirts",
    },
    update: {},
    create: {
      name: "Shirts",
      slug: "shirts",
      parentId: tops.id,
    },
  });

  const tShirts = await prisma.category.upsert({
    where: {
      slug: "t-shirts",
    },
    update: {},
    create: {
      name: "T-Shirts",
      slug: "t-shirts",
      parentId: tops.id,
    },
  });

  const tankTops = await prisma.category.upsert({
    where: {
      slug: "tank-tops",
    },
    update: {},
    create: {
      name: "Tank Tops",
      slug: "tank-tops",
      parentId: tops.id,
    },
  });

  const bottoms = await prisma.category.upsert({
    where: {
      slug: "bottoms",
    },
    update: {},
    create: {
      name: "Bottoms",
      slug: "bottoms",
      parentId: clothing.id,
    },
  });

  const jeans = await prisma.category.upsert({
    where: {
      slug: "jeans",
    },
    update: {},
    create: {
      name: "Jeans",
      slug: "jeans",
      parentId: bottoms.id,
    },
  });

  const shoes = await prisma.category.upsert({
    where: {
      slug: "shoes",
    },
    update: {},
    create: {
      name: "Shoes",
      slug: "shoes",
    },
  });

  const sneakers = await prisma.category.upsert({
    where: {
      slug: "sneakers",
    },
    update: {},
    create: {
      name: "Sneakers",
      slug: "sneakers",
      parentId: shoes.id,
    },
  });

  const formalShoes = await prisma.category.upsert({
    where: {
      slug: "formal-shoes",
    },
    update: {},
    create: {
      name: "Formal Shoes",
      slug: "formal-shoes",
      parentId: shoes.id,
    },
  });

  // ==========================================
  // COLORS
  // ==========================================

  const colorData = [
    { name: "Black", slug: "black", hex: "#000000" },
    { name: "White", slug: "white", hex: "#FFFFFF" },
    { name: "Blue", slug: "blue", hex: "#0000FF" },
    { name: "Light Blue", slug: "light-blue", hex: "#ADD8E6" },
    { name: "Red", slug: "red", hex: "#FF0000" },
    { name: "Green", slug: "green", hex: "#008000" },
    { name: "Grey", slug: "grey", hex: "#808080" },
    { name: "Brown", slug: "brown", hex: "#8B4513" },
  ];

  const colors: Record<string, any> = {};

  for (const color of colorData) {
    colors[color.name] = await prisma.color.upsert({
      where: {
        name: color.name,
      },
      update: {},
      create: color,
    });
  }

  // ==========================================
  // SIZES
  // ==========================================

  const clothingSizes = ["XS", "S", "M", "L", "XL", "XXL"];

  const sizes: Record<string, any> = {};

  for (const value of clothingSizes) {
    sizes[value] = await prisma.size.upsert({
      where: {
        category_system_value: {
          category: "clothing",
          system: SizeSystem.INTERNATIONAL,
          value,
        },
      },
      update: {},
      create: {
        category: "clothing",
        system: SizeSystem.INTERNATIONAL,
        value,
        normalizedValue: value,
      },
    });
  }

  const shoeSizes = ["39", "40", "41", "42", "43", "44", "45"];

  for (const value of shoeSizes) {
    sizes[`EU-${value}`] = await prisma.size.upsert({
      where: {
        category_system_value: {
          category: "shoes",
          system: SizeSystem.EU,
          value,
        },
      },
      update: {},
      create: {
        category: "shoes",
        system: SizeSystem.EU,
        value,
        normalizedValue: value,
      },
    });
  }

  // ==========================================
  // ATTRIBUTES
  // ==========================================

  const attributeData = [
    { name: "Sleeve", type: AttributeType.SELECT },
    { name: "Collar", type: AttributeType.SELECT },
    { name: "Fit", type: AttributeType.SELECT },
    { name: "Style", type: AttributeType.SELECT },
    { name: "Material", type: AttributeType.SELECT },
    { name: "Pattern", type: AttributeType.SELECT },
  ];

  const attributes: Record<string, any> = {};

  for (const attribute of attributeData) {
    attributes[attribute.name] = await prisma.attribute.upsert({
      where: {
        name: attribute.name,
      },
      update: {},
      create: attribute,
    });
  }

  // ==========================================
  // HELPER FOR PRODUCTS
  // ==========================================

  async function createProduct(data: {
    externalId: string;
    brand: string;
    categoryId: string;
    name: string;
    description: string;
    price: number;
    gender: Gender;
    color: string;
    size: string;
    sku: string;
    attributes: Record<string, string>;
  }) {
    const product = await prisma.product.upsert({
      where: {
        sourceId_externalId: {
          sourceId: demoSource.id,
          externalId: data.externalId,
        },
      },
      update: {
        name: data.name,
        price: data.price,
      },
      create: {
        sourceId: demoSource.id,
        externalId: data.externalId,
        brandId: brands[data.brand].id,
        categoryId: data.categoryId,
        name: data.name,
        slug: data.externalId,
        description: data.description,
        price: data.price,
        currency: "EUR",
        productUrl: "https://example.com/product",
        imageUrl: "https://placehold.co/600x800",
        gender: data.gender,
        availability: Availability.AVAILABLE,
      },
    });

    const variantSize =
      data.categoryId === sneakers.id || data.categoryId === formalShoes.id
        ? sizes[`EU-${data.size}`]
        : sizes[data.size];

    await prisma.productVariant.upsert({
      where: {
        id: `${product.id}-${data.color}-${data.size}`,
      },
      update: {},
      create: {
        id: `${product.id}-${data.color}-${data.size}`,
        productId: product.id,
        colorId: colors[data.color].id,
        sizeId: variantSize.id,
        sku: data.sku,
        price: data.price,
        currency: "EUR",
        availability: Availability.AVAILABLE,
      },
    });

    for (const [attributeName, value] of Object.entries(data.attributes)) {
      await prisma.productAttribute.upsert({
        where: {
          productId_attributeId_value: {
            productId: product.id,
            attributeId: attributes[attributeName].id,
            value,
          },
        },
        update: {},
        create: {
          productId: product.id,
          attributeId: attributes[attributeName].id,
          value,
        },
      });
    }

    return product;
  }

  // ==========================================
  // DEMO PRODUCTS
  // ==========================================

  await createProduct({
    externalId: "demo-shirt-black-sleeveless-001",
    brand: "Nike",
    categoryId: tankTops.id,
    name: "Black Sleeveless Performance Top",
    description: "Black sleeveless athletic top.",
    price: 39.99,
    gender: Gender.UNISEX,
    color: "Black",
    size: "M",
    sku: "NIKE-DEMO-001",
    attributes: {
      Sleeve: "Sleeveless",
      Collar: "Round Neck",
      Fit: "Regular",
      Style: "Sport",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-shirt-black-sleeveless-002",
    brand: "Adidas",
    categoryId: tankTops.id,
    name: "Black Essentials Tank Top",
    description: "Minimal black sleeveless top.",
    price: 34.99,
    gender: Gender.UNISEX,
    color: "Black",
    size: "M",
    sku: "ADIDAS-DEMO-001",
    attributes: {
      Sleeve: "Sleeveless",
      Collar: "Round Neck",
      Fit: "Regular",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-shirt-black-sleeveless-003",
    brand: "Zara",
    categoryId: tankTops.id,
    name: "Black Minimal Tank Top",
    description: "Minimal black sleeveless top.",
    price: 25.99,
    gender: Gender.UNISEX,
    color: "Black",
    size: "M",
    sku: "ZARA-DEMO-001",
    attributes: {
      Sleeve: "Sleeveless",
      Collar: "Round Neck",
      Fit: "Slim",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-shirt-white-001",
    brand: "H&M",
    categoryId: tShirts.id,
    name: "White Basic T-Shirt",
    description: "Classic white basic T-shirt.",
    price: 19.99,
    gender: Gender.UNISEX,
    color: "White",
    size: "M",
    sku: "HM-DEMO-001",
    attributes: {
      Sleeve: "Short Sleeve",
      Collar: "Round Neck",
      Fit: "Regular",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-shirt-blue-001",
    brand: "Puma",
    categoryId: tShirts.id,
    name: "Blue Essential T-Shirt",
    description: "Classic blue casual T-shirt.",
    price: 29.99,
    gender: Gender.MEN,
    color: "Blue",
    size: "L",
    sku: "PUMA-DEMO-001",
    attributes: {
      Sleeve: "Short Sleeve",
      Collar: "Round Neck",
      Fit: "Regular",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-jeans-blue-001",
    brand: "Zara",
    categoryId: jeans.id,
    name: "Light Blue Straight Jeans",
    description: "Light blue straight fit jeans.",
    price: 45.99,
    gender: Gender.MEN,
    color: "Light Blue",
    size: "M",
    sku: "ZARA-JEANS-001",
    attributes: {
      Sleeve: "N/A",
      Collar: "N/A",
      Fit: "Straight",
      Style: "Casual",
      Material: "Denim",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-sneaker-white-001",
    brand: "New Balance",
    categoryId: sneakers.id,
    name: "White Classic Sneaker",
    description: "Minimal white classic sneaker.",
    price: 89.99,
    gender: Gender.UNISEX,
    color: "White",
    size: "41",
    sku: "NB-SHOE-001",
    attributes: {
      Sleeve: "N/A",
      Collar: "N/A",
      Fit: "Regular",
      Style: "Classic",
      Material: "Leather",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-sneaker-white-002",
    brand: "Adidas",
    categoryId: sneakers.id,
    name: "White Everyday Sneaker",
    description: "Clean white everyday sneaker.",
    price: 79.99,
    gender: Gender.UNISEX,
    color: "White",
    size: "41",
    sku: "ADIDAS-SHOE-001",
    attributes: {
      Sleeve: "N/A",
      Collar: "N/A",
      Fit: "Regular",
      Style: "Classic",
      Material: "Synthetic",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-formal-brown-001",
    brand: "H&M",
    categoryId: formalShoes.id,
    name: "Brown Classic Derby",
    description: "Classic brown formal derby shoe.",
    price: 69.99,
    gender: Gender.MEN,
    color: "Brown",
    size: "41",
    sku: "HM-SHOE-001",
    attributes: {
      Sleeve: "N/A",
      Collar: "N/A",
      Fit: "Regular",
      Style: "Classic",
      Material: "Leather",
      Pattern: "Solid",
    },
  });

  // ==========================================
  // WOMEN DEMO PRODUCTS (for gender testing)
  // ==========================================

  await createProduct({
    externalId: "demo-women-tshirt-white-001",
    brand: "H&M",
    categoryId: tShirts.id,
    name: "Women White Classic T-Shirt",
    description: "White classic T-shirt for women.",
    price: 17.99,
    gender: Gender.WOMEN,
    color: "White",
    size: "S",
    sku: "HM-WMN-001",
    attributes: {
      Sleeve: "Short Sleeve",
      Collar: "Round Neck",
      Fit: "Slim",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-women-tank-black-001",
    brand: "Zara",
    categoryId: tankTops.id,
    name: "Women Black Basic Tank Top",
    description: "Black basic tank top for women.",
    price: 15.99,
    gender: Gender.WOMEN,
    color: "Black",
    size: "S",
    sku: "ZARA-WMN-001",
    attributes: {
      Sleeve: "Sleeveless",
      Collar: "Round Neck",
      Fit: "Slim",
      Style: "Casual",
      Material: "Cotton",
      Pattern: "Solid",
    },
  });

  await createProduct({
    externalId: "demo-women-jeans-blue-001",
    brand: "Zara",
    categoryId: jeans.id,
    name: "Women Blue Skinny Jeans",
    description: "Blue skinny fit jeans for women.",
    price: 39.99,
    gender: Gender.WOMEN,
    color: "Blue",
    size: "M",
    sku: "ZARA-WMN-002",
    attributes: {
      Sleeve: "N/A",
      Collar: "N/A",
      Fit: "Skinny",
      Style: "Casual",
      Material: "Denim",
      Pattern: "Solid",
    },
  });

  console.log("✅ Database seed completed successfully!");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });