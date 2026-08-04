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
  "favicon-vessels-v5.png",
  "apple-touch-icon-v5.png",
  "pwa-icon-512-v5.png",
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
          src: "/pwa-icon-512-v5.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any"
        }
      ]
    },
    null,
    2
  )
);

function findRelativeFile(directory, suffix, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = findRelativeFile(resolve(directory, entry.name), suffix, relative);
      if (nested) return nested;
    } else if (entry.name.endsWith(suffix)) {
      return `/${relative}`;
    }
  }
  return "";
}

const iconFontPath = findRelativeFile(dist, ".ttf");
const iconFontPreload = iconFontPath
  ? `<link rel="preload" as="font" type="font/ttf" href="${iconFontPath}" crossorigin fetchpriority="high" />`
  : "";

const splashHead = `
    <link rel="preload" as="image" href="/angiography-splash.webp" fetchpriority="high" />
    ${iconFontPreload}
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-vessels-v5.png?v=5" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-v5.png?v=5" />
    <link rel="manifest" href="/manifest.webmanifest?v=5" />
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
        background: #07131F url('/angiography-splash.webp') center / cover no-repeat;
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
let webBundlePath = "";
let bundleVersion = "development";
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
  webBundlePath = `/_expo/static/js/web/${hashedBundle}`;
  bundleVersion = bundleHash;
}
html = html.replace(/<link rel="icon"[^>]*>/i, "");
html = html.replace("</head>", `${splashHead}\n  </head>`);
html = html.replace(
  '<div id="root"></div>',
  '<div id="viewer-preboot"></div><div id="root"></div>'
);
html = html.replace(
  "</body>",
  `<script>
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
      });
    }
  </script></body>`
);
writeFileSync(indexPath, html);

const appShell = [
  "/",
  webBundlePath,
  iconFontPath,
  "/angiography-splash.webp",
  "/manifest.webmanifest?v=5",
  "/favicon-vessels-v5.png?v=5",
  "/apple-touch-icon-v5.png?v=5",
  "/pwa-icon-512-v5.png"
].filter(Boolean);

writeFileSync(
  resolve(dist, "sw.js"),
  `const CACHE_NAME = ${JSON.stringify(`viewer-shell-${bundleVersion}`)};
const APP_SHELL = ${JSON.stringify(appShell)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("viewer-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/dicom-web/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/").then((cached) => {
        const refresh = fetch(request).then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("/", response.clone()));
          return response;
        });
        return cached || refresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
`
);
