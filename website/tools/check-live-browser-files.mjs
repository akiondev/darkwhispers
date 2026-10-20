import {loadCatalog,verifyAddonFiles} from "../public/browser-install.mjs";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, options = {}) => nativeFetch(new URL(path,"https://darkwhispers.akion.se"), {
  ...options,
  headers:{...options.headers,"User-Agent":"Darkwhispers-Release-Check/1.0"}
});
try {
  const catalog = await loadCatalog();
  for (const addon of catalog.addons) {
    const files = await verifyAddonFiles(addon);
    console.log("Verified production HTTPS signature, decompressed file hashes and sizes: " + addon.id + " " + addon.version + " (" + files.size + " files).");
  }
} finally { globalThis.fetch = nativeFetch; }
