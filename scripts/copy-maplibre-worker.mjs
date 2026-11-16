// Copia o worker do MapLibre para /public, para ser servido como arquivo estático.
// O MapLibre 6 carrega o worker por URL; apontamos para esta cópia com setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const toDir = join(root, "public", "maplibre");

mkdirSync(toDir, { recursive: true });
copyFileSync(from, join(toDir, "maplibre-gl-worker.mjs"));
console.log("Worker do MapLibre copiado para public/maplibre/.");
