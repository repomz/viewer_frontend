import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(projectRoot, "dist");
const assets = resolve(projectRoot, "assets");
const indexPath = resolve(dist, "index.html");

mkdirSync(dist, { recursive: true });

for (const filename of [
  "favicon-xa-v4.png",
  "apple-touch-icon-v4.png",
  "pwa-icon-512-v4.png",
  "angiography-splash.webp"
]) {
  copyFileSync(resolve(assets, filename), resolve(dist, filename));
}

writeFileSync(
  resolve(dist, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: "Viewer Clinical",
      short_name: "Viewer",
      description: "Клинический просмотрщик протоколов и ангиографий",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#07131F",
      theme_color: "#07131F",
      icons: [
        {
          src: "/pwa-icon-512-v4.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    },
    null,
    2
  )
);

const embeddedSplash = readFileSync(
  resolve(assets, "angiography-splash.webp")
).toString("base64");

const splashHead = `
    <link rel="preload" as="image" href="/angiography-splash.webp" fetchpriority="high" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-xa-v4.png?v=4" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v4.png?v=4" />
    <link rel="manifest" href="/manifest.webmanifest?v=4" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <style id="viewer-launch-screen">
      html, body, #root {
        width: 100%;
        height: 100%;
        height: 100dvh;
        min-height: 100dvh;
        overflow: hidden;
        background: #07131F;
      }
      #viewer-preboot {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        background: #07131F url('data:image/webp;base64,${embeddedSplash}') center / cover no-repeat;
      }
      #viewer-preboot::before {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(5, 12, 21, .24);
      }
      @media (display-mode: standalone) {
        #mobile-navigation {
          position: fixed !important;
          left: 0 !important;
          right: 0 !important;
          bottom: max(6px, env(safe-area-inset-bottom, 0px)) !important;
        }
      }
    </style>`;

let html = readFileSync(indexPath, "utf8");
const webBundleDirectory = resolve(dist, "_expo/static/js/web");
const webBundle = readdirSync(webBundleDirectory).find((filename) =>
  filename.endsWith(".js")
);
if (webBundle) {
  const bundlePath = resolve(webBundleDirectory, webBundle);
  const bundleHash = createHash("sha256")
    .update(readFileSync(bundlePath))
    .digest("hex")
    .slice(0, 16);
  const hashedBundle = `index-${bundleHash}.js`;
  if (webBundle !== hashedBundle) {
    renameSync(bundlePath, resolve(webBundleDirectory, hashedBundle));
    html = html.replace(
      `/_expo/static/js/web/${webBundle}`,
      `/_expo/static/js/web/${hashedBundle}`
    );
  }
}
html = html.replace(/<link rel="icon"[^>]*>/i, "");
html = html.replace("</head>", `${splashHead}\n  </head>`);
html = html.replace(
  '<div id="root"></div>',
  '<div id="viewer-preboot"></div><div id="root"></div>'
);
writeFileSync(indexPath, html);
