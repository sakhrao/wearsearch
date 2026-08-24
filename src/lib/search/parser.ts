const colors = [
    "black",
    "white",
    "blue",
    "light blue",
    "red",
    "green",
    "grey",
    "brown",
  ];
  
  const categories = [
    { keywords: ["shirt", "shirts"], slug: "shirts" },
    { keywords: ["t-shirt", "t-shirts"], slug: "t-shirts" },
    { keywords: ["tank", "tank top", "tank tops"], slug: "tank-tops" },
    { keywords: ["jean", "jeans"], slug: "jeans" },
    { keywords: ["shoe", "shoes"], slug: "shoes" },
    { keywords: ["sneaker", "sneakers"], slug: "sneakers" },
    { keywords: ["formal shoe", "formal shoes"], slug: "formal-shoes" },
  ];
  
  const sizePattern = /^(xs|s|m|l|xl|xxl|39|40|41|42|43|44|45)$/i;
  
  const brands = [
    "nike",
    "adidas",
    "puma",
    "zara",
    "h&m",
    "new balance",
  ];
  
  export type ParsedSearch = {
    originalQuery: string;
    text: string;
    color?: string;
    categorySlug?: string;
    brand?: string;
    size?: string;
  };
  
  export function parseSearchQuery(query: string): ParsedSearch {
    const normalized = query.toLowerCase().trim();
  
    let remaining = normalized;
  
    let color: string | undefined;
    let categorySlug: string | undefined;
    let brand: string | undefined;
    let size: string | undefined;
  
    // -----------------------------
    // Color
    // -----------------------------
  
    const colorMatch = colors.find((item) =>
      remaining.includes(item)
    );
  
    if (colorMatch) {
      color = colorMatch;
  
      remaining = remaining.replace(
        new RegExp(`\\b${escapeRegExp(colorMatch)}\\b`, "gi"),
        ""
      );
    }
  
    // -----------------------------
    // Category
    // -----------------------------
  
    for (const category of categories) {
      const keyword = category.keywords.find((item) =>
        remaining.includes(item)
      );
  
      if (keyword) {
        categorySlug = category.slug;
  
        remaining = remaining.replace(
          new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi"),
          ""
        );
  
        break;
      }
    }
  
    // -----------------------------
    // Brand
    // -----------------------------
  
    const brandMatch = brands.find((item) =>
      remaining.includes(item)
    );
  
    if (brandMatch) {
      brand = brandMatch;
  
      remaining = remaining.replace(
        new RegExp(`\\b${escapeRegExp(brandMatch)}\\b`, "gi"),
        ""
      );
    }
  
    // -----------------------------
    // Size
    // -----------------------------
  
    const words = remaining.split(/\s+/);
  
    const remainingWords: string[] = [];
  
    for (const word of words) {
      if (!word) continue;
  
      if (sizePattern.test(word)) {
        size = word.toUpperCase();
      } else {
        remainingWords.push(word);
      }
    }
  
    return {
      originalQuery: query,
      text: remainingWords.join(" ").trim(),
      color,
      categorySlug,
      brand,
      size,
    };
  }
  
  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }