import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBinary } from "../linkedin.js";

const PNG = new Uint8Array([137, 80, 78, 71]);

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "linkedin-mcp-media-"));
  const media = join(base, "media");
  await mkdir(join(media, "sub"), { recursive: true });
  await writeFile(join(media, "pic.png"), PNG);
  await writeFile(join(media, "sub", "deep.jpg"), PNG);
  await writeFile(join(base, "secret.png"), PNG); // outside the media folder
  await writeFile(join(media, "notes.txt"), "not an image");
  await symlink(join(base, "secret.png"), join(media, "link.png")); // points outside
  return { base, media, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const noFetch = (async () => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

test("loads images inside the media folder, by name or absolute path", async () => {
  const { media, cleanup } = await setup();
  try {
    assert.equal((await loadBinary("pic.png", noFetch, media)).contentType, "image/png");
    assert.equal((await loadBinary(join(media, "sub", "deep.jpg"), noFetch, media)).contentType, "image/jpeg");
  } finally {
    await cleanup();
  }
});

test("rejects files outside the media folder, traversal and escaping symlinks", async () => {
  const { base, media, cleanup } = await setup();
  try {
    for (const source of [join(base, "secret.png"), "../secret.png", "link.png"]) {
      await assert.rejects(loadBinary(source, noFetch, media), /inside the media folder/, source);
    }
  } finally {
    await cleanup();
  }
});

test("rejects non-image files and missing folders", async () => {
  const { base, media, cleanup } = await setup();
  try {
    await assert.rejects(loadBinary("notes.txt", noFetch, media), /Unsupported image type/);
    await assert.rejects(loadBinary("/etc/passwd", noFetch, media), /Unsupported image type/);
    await assert.rejects(loadBinary("pic.png", noFetch, join(base, "missing")), /does not exist/);
  } finally {
    await cleanup();
  }
});

test("remote images must be https and served as image/*", async () => {
  const serve = (type: string) =>
    (async () => new Response(PNG, { headers: { "content-type": type } })) as unknown as typeof fetch;
  await assert.rejects(loadBinary("http://img.example/a.png", serve("image/png")), /https/);
  await assert.rejects(
    loadBinary("https://169.254.169.254/latest/meta-data/", serve("text/plain")),
    /is not an image/,
  );
  const ok = await loadBinary("https://img.example/a.png", serve("image/png; charset=binary"));
  assert.equal(ok.contentType, "image/png");
});
