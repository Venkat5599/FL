/**
 * Package the browser extension into a distributable ZIP.
 *
 * The extension is plain JS/CSS with no build step, so "building" it means exactly one
 * thing: producing the archive a user loads unpacked, and the archive the Chrome Web
 * Store accepts. Both want the same shape — manifest.json at the ROOT of the zip, not
 * nested inside a folder. A nested manifest is the single most common reason "Load
 * unpacked" and Web Store upload both reject an otherwise-fine extension.
 *
 * Written with Node's zlib rather than an archiver dependency: a zip is a well-specified
 * container, this one has nine small files in it, and adding a dependency to the app's
 * bundle for a build-time script is a poor trade.
 *
 * Usage: bun scripts/build-extension.ts
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SOURCE = path.join(process.cwd(), "extension");
const OUT = path.join(process.cwd(), "public", "tape-extension.zip");

/** Files that must never ship to users, whatever ends up in the folder. */
const EXCLUDE = new Set([".DS_Store", "Thumbs.db", ".gitignore"]);

function walk(dir: string, prefix = ""): { name: string; body: Buffer }[] {
  const out: { name: string; body: Buffer }[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDE.has(entry)) continue;
    const full = path.join(dir, entry);
    // Forward slashes: the zip spec requires them, and on Windows path.join gives
    // backslashes, which produce an archive Chrome silently reads as one flat file
    // with a very strange name.
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, name));
    else out.push({ name, body: readFileSync(full) });
  }
  return out;
}

// CRC-32, needed per entry by the zip format. Table built once.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zip(files: { name: string; body: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.body);
    const deflated = deflateRawSync(f.body);
    // Store rather than deflate when compression makes the entry bigger, which happens
    // with the small PNG icons — they are already compressed.
    const useDeflate = deflated.length < f.body.length;
    const data = useDeflate ? deflated : f.body;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(f.body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

const files = walk(SOURCE);
if (!files.some((f) => f.name === "manifest.json")) {
  // Fail loudly. A zip without a root manifest installs nowhere, and the error Chrome
  // gives ("Manifest file is missing or unreadable") sends people looking in the wrong
  // place entirely.
  throw new Error("no manifest.json at the root of extension/ — refusing to build");
}

const manifest = JSON.parse(readFileSync(path.join(SOURCE, "manifest.json"), "utf8"));
const archive = zip(files);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, archive);

console.log(`${manifest.name} v${manifest.version}`);
for (const f of files) console.log(`  ${f.name} (${f.body.length}b)`);
console.log(`\n-> public/tape-extension.zip  ${archive.length}b`);
console.log(`   sha256 ${createHash("sha256").update(archive).digest("hex").slice(0, 32)}…`);
