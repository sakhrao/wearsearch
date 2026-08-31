import "dotenv/config";

import {
  PrismaClient,
  SourceType,
  SourceStatus,
  Availability,
  Gender,
  SizeSystem,
  SizeAudience,
  SizeProductType,
  AttributeType,
} from "../src/generated/prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  expansionProducts,
  type ExpansionProductSpec,
} from "./catalog-data";

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
    update: {
      baseUrl: null,
    },
    create: {
      name: "WearSearch Demo Store",
      type: SourceType.DEMO,
      baseUrl: null,
      status: SourceStatus.ACTIVE,
    },
  });

  const affiliateSource = await prisma.source.upsert({
    where: {
      name: "StyleHub Affiliate Feed",
    },
    update: {},
    create: {
      name: "StyleHub Affiliate Feed",
      type: SourceType.AFFILIATE_FEED,
      baseUrl: "https://feeds.stylehub.example",
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

  const brands: Record<string, { id: string }> = {};

  for (const name of brandNames) {
    brands[name] = await prisma.brand.upsert({
      where: {
        name,
      },
      update: {},
      create: {
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        websiteUrl: null,
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

  const polos = await prisma.category.upsert({
    where: { slug: "polos" },
    update: {},
    create: {
      name: "Polos",
      slug: "polos",
      parentId: tops.id,
    },
  });

  const blouses = await prisma.category.upsert({
    where: { slug: "blouses" },
    update: {},
    create: {
      name: "Blouses",
      slug: "blouses",
      parentId: tops.id,
    },
  });

  const cardigans = await prisma.category.upsert({
    where: { slug: "cardigans" },
    update: {},
    create: {
      name: "Cardigans",
      slug: "cardigans",
      parentId: tops.id,
    },
  });

  const chinos = await prisma.category.upsert({
    where: { slug: "chinos" },
    update: {},
    create: {
      name: "Chinos",
      slug: "chinos",
      parentId: bottoms.id,
    },
  });

  const trousers = await prisma.category.upsert({
    where: { slug: "trousers" },
    update: {},
    create: {
      name: "Trousers",
      slug: "trousers",
      parentId: bottoms.id,
    },
  });

  const leggings = await prisma.category.upsert({
    where: { slug: "leggings" },
    update: {},
    create: {
      name: "Leggings",
      slug: "leggings",
      parentId: bottoms.id,
    },
  });

  const joggers = await prisma.category.upsert({
    where: { slug: "joggers" },
    update: {},
    create: {
      name: "Joggers",
      slug: "joggers",
      parentId: bottoms.id,
    },
  });

  const boots = await prisma.category.upsert({
    where: { slug: "boots" },
    update: {},
    create: {
      name: "Boots",
      slug: "boots",
      parentId: shoes.id,
    },
  });

  const loafers = await prisma.category.upsert({
    where: { slug: "loafers" },
    update: {},
    create: {
      name: "Loafers",
      slug: "loafers",
      parentId: shoes.id,
    },
  });

  const sandals = await prisma.category.upsert({
    where: { slug: "sandals" },
    update: {},
    create: {
      name: "Sandals",
      slug: "sandals",
      parentId: shoes.id,
    },
  });

  const hoodies = await prisma.category.upsert({
    where: { slug: "hoodies" },
    update: {},
    create: {
      name: "Hoodies",
      slug: "hoodies",
      parentId: tops.id,
    },
  });

  const jumpers = await prisma.category.upsert({
    where: { slug: "jumpers" },
    update: {},
    create: {
      name: "Jumpers",
      slug: "jumpers",
      parentId: tops.id,
    },
  });

  const sweatshirts = await prisma.category.upsert({
    where: { slug: "sweatshirts" },
    update: {},
    create: {
      name: "Sweatshirts",
      slug: "sweatshirts",
      parentId: tops.id,
    },
  });

  const jackets = await prisma.category.upsert({
    where: { slug: "jackets" },
    update: {},
    create: {
      name: "Jackets",
      slug: "jackets",
      parentId: tops.id,
    },
  });

  const shorts = await prisma.category.upsert({
    where: { slug: "shorts" },
    update: {},
    create: {
      name: "Shorts",
      slug: "shorts",
      parentId: bottoms.id,
    },
  });

  const cargo = await prisma.category.upsert({
    where: { slug: "cargo" },
    update: {},
    create: {
      name: "Cargo",
      slug: "cargo",
      parentId: bottoms.id,
    },
  });

  const socks = await prisma.category.upsert({
    where: { slug: "socks" },
    update: {},
    create: {
      name: "Socks",
      slug: "socks",
      parentId: bottoms.id,
    },
  });

  const underwear = await prisma.category.upsert({
    where: { slug: "underwear" },
    update: {},
    create: {
      name: "Underwear",
      slug: "underwear",
      parentId: bottoms.id,
    },
  });

  const runningTrainers = await prisma.category.upsert({
    where: { slug: "running-trainers" },
    update: {},
    create: {
      name: "Running Trainers",
      slug: "running-trainers",
      parentId: shoes.id,
    },
  });

  const heels = await prisma.category.upsert({
    where: { slug: "heels" },
    update: {},
    create: {
      name: "Heels",
      slug: "heels",
      parentId: shoes.id,
    },
  });

  const accessories = await prisma.category.upsert({
    where: { slug: "accessories" },
    update: {},
    create: {
      name: "Accessories",
      slug: "accessories",
    },
  });

  const sunglasses = await prisma.category.upsert({
    where: { slug: "sunglasses" },
    update: {},
    create: {
      name: "Sunglasses",
      slug: "sunglasses",
      parentId: accessories.id,
    },
  });

  const watches = await prisma.category.upsert({
    where: { slug: "watches" },
    update: {},
    create: {
      name: "Watches",
      slug: "watches",
      parentId: accessories.id,
    },
  });

  const belts = await prisma.category.upsert({
    where: { slug: "belts" },
    update: {},
    create: {
      name: "Belts",
      slug: "belts",
      parentId: accessories.id,
    },
  });

  const ties = await prisma.category.upsert({
    where: { slug: "ties" },
    update: {},
    create: {
      name: "Ties",
      slug: "ties",
      parentId: accessories.id,
    },
  });

  const headwear = await prisma.category.upsert({
    where: { slug: "headwear" },
    update: {},
    create: {
      name: "Headwear",
      slug: "headwear",
    },
  });

  const beanies = await prisma.category.upsert({
    where: { slug: "beanies" },
    update: {},
    create: {
      name: "Beanies",
      slug: "beanies",
      parentId: headwear.id,
    },
  });

  const hats = await prisma.category.upsert({
    where: { slug: "hats" },
    update: {},
    create: {
      name: "Hats",
      slug: "hats",
      parentId: headwear.id,
    },
  });

  const caps = await prisma.category.upsert({
    where: { slug: "caps" },
    update: {},
    create: {
      name: "Caps",
      slug: "caps",
      parentId: headwear.id,
    },
  });

  const categoryBySlug: Record<string, { id: string }> = {
    "t-shirts": tShirts,
    "tank-tops": tankTops,
    jeans,
    sneakers,
    "formal-shoes": formalShoes,
    polos,
    blouses,
    cardigans,
    chinos,
    trousers,
    leggings,
    joggers,
    boots,
    loafers,
    sandals,
  };

  const SHOE_CATEGORY_SLUGS = new Set([
    "sneakers",
    "formal-shoes",
    "boots",
    "loafers",
    "sandals",
    "running-trainers",
    "heels",
  ]);

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

  const colors: Record<string, { id: string }> = {};

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

  const sizes: Record<string, { id: string }> = {};

  for (const value of clothingSizes) {
    sizes[value] = await prisma.size.upsert({
      where: {
        audience_productType_system_value: {
          audience: SizeAudience.UNKNOWN,
          productType: SizeProductType.UNKNOWN,
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
        audience_productType_system_value: {
          audience: SizeAudience.UNKNOWN,
          productType: SizeProductType.UNKNOWN,
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

  const attributes: Record<string, { id: string }> = {};

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
        productUrl: "",
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
        productUrl: "",
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

  /* ==========================================
     EXPANSION CATALOG (StyleHub feed)
     Multi-variant, realistic store URLs.
  ========================================== */

  async function createExpansionProduct(
    spec: ExpansionProductSpec
  ) {
    const category = categoryBySlug[
      spec.categorySlug
    ];

    const product = await prisma.product.upsert({
      where: {
        sourceId_externalId: {
          sourceId: affiliateSource.id,
          externalId: spec.externalId,
        },
      },
      update: {
        name: spec.name,
        price: spec.price,
        productUrl: spec.productUrl,
      },
      create: {
        sourceId: affiliateSource.id,
        externalId: spec.externalId,
        brandId: brands[spec.brand].id,
        categoryId: category.id,
        name: spec.name,
        slug: spec.externalId,
        description: spec.description,
        price: spec.price,
        currency: "EUR",
        productUrl: spec.productUrl,
        imageUrl: "https://placehold.co/600x800",
        gender: spec.gender,
        availability: Availability.AVAILABLE,
      },
    });

    for (const [
      variantIndex,
      variantSpec,
    ] of spec.variants.entries()) {
      const sizeKey = SHOE_CATEGORY_SLUGS.has(
        spec.categorySlug
      )
        ? `EU-${variantSpec.size}`
        : variantSpec.size;

      await prisma.productVariant.upsert({
        where: {
          id: `${product.id}-${variantSpec.color}-${variantSpec.size}`,
        },
        update: {},
        create: {
          id: `${product.id}-${variantSpec.color}-${variantSpec.size}`,
          productId: product.id,
          colorId:
            colors[variantSpec.color].id,
          sizeId: sizes[sizeKey].id,
          sku: `${spec.externalId}-${variantSpec.color}-${variantSpec.size}`.toUpperCase(),
          price: variantSpec.price ?? spec.price,
          currency: "EUR",
          availability:
            variantSpec.availability ??
            Availability.AVAILABLE,
        },
      });
    }

    for (const [attributeName, value] of Object.entries(
      spec.attributes
    )) {
      await prisma.productAttribute.upsert({
        where: {
          productId_attributeId_value: {
            productId: product.id,
            attributeId:
              attributes[attributeName].id,
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

  console.log(
    `📦 Importing ${expansionProducts.length} expansion products...`
  );

  for (const spec of expansionProducts) {
    await createExpansionProduct(spec);
  }

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