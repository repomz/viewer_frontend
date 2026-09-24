import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
const serviceWorker = readFileSync(resolve(root, "dist/sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "dist/manifest.webmanifest"), "utf8"));

function pngSize(filename) {
  const image = readFileSync(resolve(root, "dist", filename));
  if (image.toString("ascii", 1, 4) !== "PNG") throw new Error(`${filename} is not a PNG`);
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

const requirements = [
  [manifest.id === "/" && manifest.start_url === "/" && manifest.scope === "/", "manifest identity is not canonical"],
  [manifest.icons.some((icon) => icon.src === "/pwa-icon-192-v6.png" && icon.sizes === "192x192"), "192px manifest icon is missing"],
  [manifest.icons.some((icon) => icon.src === "/pwa-icon-512-v5.png" && icon.sizes === "512x512"), "512px manifest icon is missing"],
  [html.includes(`/apple-touch-icon.png?v=${version}`), "Apple icon is not versioned with the app"],
  [html.includes(`/manifest.webmanifest?v=${version}`), "manifest is not versioned with the app"],
  [pngSize("apple-touch-icon.png").join("x") === "180x180", "Apple icon must be exactly 180x180"],
  [pngSize("pwa-icon-192-v6.png").join("x") === "192x192", "PWA small icon must be exactly 192x192"],
  [pngSize("pwa-icon-512-v5.png").join("x") === "512x512", "PWA large icon must be exactly 512x512"],
  [html.includes("#viewer-login-background"), "login and preboot backgrounds must share one web canvas"],
  [html.includes("data:image/webp;base64"), "first HTML paint must embed the final splash image"],
  [!html.includes("controllerchange"), "service worker updates must not force a visible page reload"],
  [!serviceWorker.includes("skipWaiting") && !serviceWorker.includes("clients.claim"), "service worker must activate only after the current PWA session closes"],
  [html.includes("height: 100lvh !important"), "standalone PWA must use stable large viewport geometry"],
  [html.includes("bottom: max(6px, env(safe-area-inset-bottom, 0px))"), "mobile navigation must have one CSS safe-area owner"],
];

const failed = requirements.filter(([ok]) => !ok).map(([, message]) => message);
if (failed.length) throw new Error(`Web build verification failed:\n- ${failed.join("\n- ")}`);
console.log(`Verified Viewer web build v${version}: manifest and iOS icons are canonical.`);
