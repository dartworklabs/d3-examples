#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fetchHttpsText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function fetchHttpsBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function inlineScript(html, scriptContent) {
  // Use data URL to avoid inline </script> parsing pitfalls entirely
  const b64 = Buffer.from(scriptContent, 'utf8').toString('base64');
  const dataSrc = `data:text/javascript;base64,${b64}`;
  return html.replace(
    /<script\s+src="https:\/\/d3js.org\/d3\.v7\.min\.js"><\/script>/,
    `<script src="${dataSrc}"></script>`
  );
}

function extractGoogleFontLink(html) {
  const m = html.match(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"[^>]*>/);
  return m ? m[1] : null;
}

function removeGoogleFontLink(html) {
  return html.replace(/\n?\s*<link[^>]+href="https:\/\/fonts\.googleapis\.com\/[^"]+"[^>]*>\n?/, '\n');
}

async function buildInlineGoogleFontStyle(googleCssUrl) {
  const css = await fetchHttpsText(googleCssUrl);
  // Replace each url(...) with data: URL
  const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[\w\-\/\.@%?=&]+)\)/g;
  let replaced = css;
  const urls = Array.from(css.matchAll(urlRegex)).map((m) => m[1]);
  for (const u of urls) {
    const buf = await fetchHttpsBuffer(u);
    const b64 = buf.toString('base64');
    const mime = u.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
    replaced = replaced.replaceAll(u, `data:${mime};base64,${b64}`);
  }
  return `<style>\n${replaced}\n</style>`;
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const htmlPath = path.join(projectRoot, 'examples/sim-force/index.html');
  const outPath = path.join(projectRoot, 'examples/sim-force/index.single.html');
  const assetsDir = path.join(projectRoot, 'assets');

  let html = await fs.readFile(htmlPath, 'utf8');

  // Inline D3
  const d3Code = await fetchHttpsText('https://d3js.org/d3.v7.min.js');
  html = inlineScript(html, d3Code);

  // Inline Google Fonts
  const googleCssUrl = extractGoogleFontLink(html);
  if (googleCssUrl) {
    const fontStyleTag = await buildInlineGoogleFontStyle(googleCssUrl);
    html = removeGoogleFontLink(html);
    // Insert style after <head> open
    html = html.replace('<head>', `<head>\n${fontStyleTag}`);
  }

  // Inline JSON assets into the two <script type="application/json"> tags
  const simJsonPath = path.join(assetsDir, 'similarities.json');
  const tsJsonPath = path.join(assetsDir, 'ts-2009-2010-3m.json');
  const [simText, tsText] = await Promise.all([
    fs.readFile(simJsonPath, 'utf8'),
    fs.readFile(tsJsonPath, 'utf8'),
  ]);

  html = html.replace(
    /<script id="sim-data" type="application\/json"><\/script>/,
    `<script id="sim-data" type="application/json">\n${simText}\n<\/script>`
  );
  html = html.replace(
    /<script id="ts-data" type="application\/json"><\/script>/,
    `<script id="ts-data" type="application/json">\n${tsText}\n<\/script>`
  );

  // Ensure fetch fallback points to relative assets if kept (not required, but harmless)
  await fs.writeFile(outPath, html, 'utf8');
  console.log(`Packed single file: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


