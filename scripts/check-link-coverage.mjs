import { readFileSync } from 'node:fs';

const notebook = JSON.parse(readFileSync(new URL('../src/notebook/data/notebook.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../src/notebook/data/coverage.json', import.meta.url), 'utf8'));

const left = notebook.chrome.left.length;
const right = notebook.chrome.right.length;
let top = 0;
let content = 0;
for (const page of notebook.pages) {
    top += page.topNav.length;
    content += page.links.length;
}
const chrome = (left + right) * coverage.pagesWithChrome;
const shipped = chrome + top + content;

console.log(JSON.stringify({
    pdfLinks: coverage.pdfLinks,
    chrome,
    topNav: top,
    content,
    shipped,
    match: shipped === coverage.pdfLinks,
    coveragePct: coverage.coveragePct,
    fonts: coverage.fonts,
}, null, 2));

if (shipped !== coverage.pdfLinks) {
    process.exit(1);
}
