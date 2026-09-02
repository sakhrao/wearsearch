import "dotenv/config";
import { defineConfig } from "prisma/config";

/* DATABASE_URL is intentionally read directly (NOT via the throwing
   env() helper) so that `prisma generate` can run during a fresh
   deployment ("postinstall") even before a production DATABASE_URL is
   configured. prisma generate never connects to the database; the
   placeholder below only satisfies config load. It is NOT a real
   connection string and contains no credentials. At runtime the app
   reads the real DATABASE_URL via @/lib/prisma. */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  datasource: {
    url:
      databaseUrl ||
      // Non-secret generate-time placeholder only (never used to connect).
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});