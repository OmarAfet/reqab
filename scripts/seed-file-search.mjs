/**
 * Seeds the Gemini File Search store with the SAMA regulations corpus.
 *
 * Usage: node --env-file=.env scripts/seed-file-search.mjs
 *
 * Creates (or reuses) a store named "reqab-sama-corpus", uploads every file
 * in ./corpus that is not already indexed, waits until each document reaches
 * a terminal state (ACTIVE/FAILED), retries failures once, then prints the
 * store resource name to put in FILE_SEARCH_STORE_NAME.
 */
import { GoogleGenAI } from "@google/genai";
import { readdir } from "node:fs/promises";
import path from "node:path";

const STORE_DISPLAY_NAME = "reqab-sama-corpus";
const CORPUS_DIR = path.join(process.cwd(), "corpus");
const POLL_MS = 5000;
const DOC_TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY missing. Run with: node --env-file=.env scripts/seed-file-search.mjs");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function findExistingStore() {
  const pager = await ai.fileSearchStores.list();
  for await (const store of pager) {
    if (store.displayName === STORE_DISPLAY_NAME) return store;
  }
  return null;
}

async function findDocument(storeName, displayName) {
  const pager = await ai.fileSearchStores.documents.list({ parent: storeName });
  for await (const doc of pager) {
    if (doc.displayName === displayName) return doc;
  }
  return null;
}

async function uploadAndWait(storeName, filePath, displayName) {
  await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: storeName,
    file: filePath,
    config: { displayName, mimeType: "text/plain" },
  });
  const deadline = Date.now() + DOC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const doc = await findDocument(storeName, displayName);
    if (doc?.state === "STATE_ACTIVE") return { ok: true };
    if (doc?.state === "STATE_FAILED") return { ok: false, doc };
  }
  return { ok: false, timedOut: true };
}

let store = await findExistingStore();
if (store) {
  console.log(`Reusing store: ${store.name}`);
} else {
  store = await ai.fileSearchStores.create({
    config: { displayName: STORE_DISPLAY_NAME },
  });
  console.log(`Created store: ${store.name}`);
}

const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
if (files.length === 0) {
  console.error(`No .txt/.md files found in ${CORPUS_DIR}`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const displayName = file.replace(/\.(txt|md)$/, "");
  const existing = await findDocument(store.name, displayName);
  if (existing?.state === "STATE_ACTIVE") {
    console.log(`Skipping ${displayName} (already indexed)`);
    continue;
  }
  if (existing) {
    console.log(`Removing stale ${displayName} (state: ${existing.state})`);
    await ai.fileSearchStores.documents.delete({ name: existing.name, config: { force: true } });
  }

  const filePath = path.join(CORPUS_DIR, file);
  let done = false;
  for (let attempt = 1; attempt <= 2 && !done; attempt++) {
    process.stdout.write(`Uploading ${displayName} (attempt ${attempt}) ... `);
    const res = await uploadAndWait(store.name, filePath, displayName);
    if (res.ok) {
      console.log("indexed");
      done = true;
    } else {
      console.log(res.timedOut ? "TIMED OUT" : "FAILED");
      if (res.doc) {
        await ai.fileSearchStores.documents.delete({ name: res.doc.name, config: { force: true } });
      }
    }
  }
  if (!done) failures++;
}

console.log("\nStore contents:");
const pager = await ai.fileSearchStores.documents.list({ parent: store.name });
for await (const d of pager) console.log(`  ${d.displayName}: ${d.state}`);

console.log(`\n${failures === 0 ? "Done." : `Done with ${failures} failure(s).`} Add this to .env and Vercel env:`);
console.log(`FILE_SEARCH_STORE_NAME=${store.name}`);
process.exit(failures === 0 ? 0 : 2);
