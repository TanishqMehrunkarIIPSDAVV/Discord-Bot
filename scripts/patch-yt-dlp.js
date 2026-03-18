const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", "node_modules", "@distube", "yt-dlp", "dist", "index.js");

try {
  if (!fs.existsSync(target)) {
    console.log("[postinstall] @distube/yt-dlp not found, skipping patch.");
    process.exit(0);
  }

  const source = fs.readFileSync(target, "utf8");
  const patched = source.replace(/\s*noCallHome:\s*true,\r?\n/g, "");

  if (patched !== source) {
    fs.writeFileSync(target, patched, "utf8");
    console.log("[postinstall] Patched @distube/yt-dlp to remove deprecated noCallHome flag.");
  } else {
    console.log("[postinstall] noCallHome flag already absent.");
  }
} catch (err) {
  console.error("[postinstall] Failed to patch @distube/yt-dlp:", err.message);
  process.exit(1);
}
