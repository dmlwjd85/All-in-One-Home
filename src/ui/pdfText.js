/**
 * PDF 를 기기 안에서 읽습니다(어디에도 보내지 않습니다). pdf.js 는 PDF 를 고를 때만 받습니다.
 * - 글이 들어 있는 PDF: 글 조각의 위치로 줄과 칸을 나눠 표 글로 돌려줍니다.
 * - 스캔한 PDF(글이 없음): 첫 쪽을 그림으로 그려 돌려주면, 부른 쪽이 사진 읽기로 넘깁니다.
 */
import { pdfItemsToTsv, pdfPageItems } from '../lib/docFile.js';

const MAX_PAGES = 6;
let libPromise = null;

/* pdf.js 는 묶지 않고, 빌드할 때 옮겨 둔 파일(./pdf/)을 그대로 받습니다(vite.config.js copyPdfFiles).
   오래된 브라우저도 되도록 legacy 판을 씁니다. 못 받으면 다음에 다시 받습니다. */
function loadPdfLib() {
    if (!libPromise) {
        const base = new URL('pdf/', globalThis.document?.baseURI || globalThis.location?.href).href;
        libPromise = import(/* @vite-ignore */ `${base}pdf.min.mjs`).then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
            return { lib, base };
        }).catch((error) => { libPromise = null; throw error; });
    }
    return libPromise;
}

export async function readPdf(bytes) {
    const { lib: pdfjs, base } = await loadPdfLib();
    const cMapUrl = `${base}cmaps/`;
    const doc = await pdfjs.getDocument({ data: bytes, cMapUrl, cMapPacked: true, isEvalSupported: false }).promise;
    try {
        const texts = [];
        const pages = Math.min(doc.numPages, MAX_PAGES);
        for (let n = 1; n <= pages; n += 1) {
            const page = await doc.getPage(n);
            const view = page.getViewport({ scale: 1 });
            const tsv = pdfItemsToTsv(pdfPageItems(await page.getTextContent(), view.height));
            if (tsv.trim()) texts.push(tsv);
        }
        const text = texts.join('\n');
        if (text.replace(/\s/g, '').length >= 20) return { text, pages: doc.numPages, image: null };
        /* 글이 없는 PDF: 첫 쪽을 크게 그려 사진처럼 읽습니다. */
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(4, 3200 / Math.max(base.width, base.height));
        const view = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: view, canvas }).promise;
        const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        return { text: '', pages: doc.numPages, image };
    } finally {
        try { await doc.destroy(); } catch { /* 이미 닫힘 */ }
    }
}
