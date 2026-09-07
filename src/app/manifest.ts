import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FitWear",
    short_name: "FitWear",
    description:
      "Find the clothes you are looking for — search a real catalog by category, color, brand, size or budget and open genuine product pages.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6f0",
    theme_color: "#faf6f0",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}