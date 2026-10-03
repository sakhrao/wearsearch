import { writeFileSync } from "node:fs";
import { taxonomyDefinition, taxonomyTrees } from "../src/lib/catalog/taxonomy/definition";

function slugPart(label: string): string {
  return label
    .toLowerCase()
    .replace(/[-']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const reverseMigration: Record<string, string[]> = {};
for (const [slug, ids] of Object.entries(taxonomyDefinition.migrationMap)) {
  for (const id of ids) {
    (reverseMigration[id] ??= []).push(slug);
  }
}

const DEPRECATE = new Set<string>(["mens_bottoms_cargo_pants"]);

const header = [
  "id",
  "gender",
  "label",
  "type",
  "parentId",
  "childCount",
  "mapToCount",
  "mapTo",
  "migrationSlugs",
  "proposedConceptId",
  "styleId",
  "requiresSize",
  "age",
  "crossTags",
  "status",
].join("\t");

const rows: string[] = [header];
let productBound = 0;
let structural = 0;

for (const g of ["MEN", "WOMEN", "KIDS"] as const) {
  const tree = taxonomyTrees[g];
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id];
    const slugs = reverseMigration[id] ?? [];
    let concept: string;
    if (n.styleId) concept = `style:${n.styleId}`;
    else if (slugs.length) concept = `cat:${slugs[0]}`;
    else concept = `struct:${slugPart(n.label)}`;

    const status = DEPRECATE.has(id) ? "DEPRECATE" : "KEEP";
    if (n.mapTo.length) productBound++;
    else structural++;

    rows.push(
      [
        id,
        g,
        n.label,
        n.type,
        n.parentId ?? "",
        String(n.children.length),
        String(n.mapTo.length),
        n.mapTo.join("|"),
        slugs.join("|"),
        concept,
        n.styleId ?? "",
        String(n.requiresSize),
        n.age.join("|"),
        n.crossTags.join("|"),
        status,
      ].join("\t")
    );
  }
}

const out = "C:/Users/sakhr/Desktop/wearsearch/docs/canonical-taxonomy/PHASE-02-ID-INVENTORY.tsv";
writeFileSync(out, rows.join("\n") + "\n", "utf8");
console.log(`rows=${rows.length - 1}`);
console.log(`productBound(mapTo)=${productBound} structural(no mapTo)=${structural}`);
