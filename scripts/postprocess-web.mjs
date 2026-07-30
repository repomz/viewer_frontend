import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(projectRoot, "dist");
const assets = resolve(projectRoot, "assets");
const indexPath = resolve(dist, "index.html");

mkdirSync(dist, { recursive: true });

for (const filename of [
  "favicon-xa-v3.png",
  "apple-touch-icon-v3.png",
  "pwa-icon-512-v3.png",
  "splash-xa-v3.png"
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
          src: "/pwa-icon-512-v3.png",
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

const splashMarkup = `
    <div id="app-splash" aria-hidden="true">
      <img src="/splash-xa-v3.png" alt="" />
    </div>`;
const splashHead = `
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-xa-v3.png?v=3" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v3.png?v=3" />
    <link rel="manifest" href="/manifest.webmanifest?v=3" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <style id="viewer-launch-screen">
      html, body { background: #07131F; }
      #app-splash {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background: #07131F;
        opacity: 1;
        transition: opacity 180ms ease-out;
        pointer-events: none;
      }
      #app-splash img {
        width: min(58vw, 300px);
        height: min(58vw, 300px);
        object-fit: contain;
      }
      #app-splash.viewer-splash-hidden { opacity: 0; }
    </style>`;

let html = readFileSync(indexPath, "utf8");
html = html.replace(/<link rel="icon"[^>]*>/i, "");
html = html.replace("</head>", `${splashHead}\n  </head>`);
html = html.replace(
  '<div id="root"></div>',
  `<div id="root"></div>${splashMarkup}`
);
writeFileSync(indexPath, html);
