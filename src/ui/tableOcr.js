/**
 * 표 사진을 기기 안에서 읽습니다. 언어 자료는 처음 한 번만 받고, 그 다음부터는 같은 작업자를 씁니다.
 * 이미지는 저장하지 않고 서버로 보내지 않습니다.
 */
import { assignWords, cellsToTable, clippedNotes, clusterTable, detectGridLines } from '../lib/gridDetect.js';

let workerPromise = null;

export function loadOcrWorker() {
    if (!workerPromise) {
        workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('kor+eng', 1, {
            langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        }));
    }
    return workerPromise;
}

function wordsOf(data) {
    return (data?.words || []).map((word) => ({
        text: word.text,
        x: word.bbox?.x0 ?? 0,
        y: word.bbox?.y0 ?? 0,
        x1: word.bbox?.x1 ?? 0,
        y1: word.bbox?.y1 ?? 0,
        conf: word.confidence,
    }));
}

/** 사진 파일에서 표 글(탭)과 잘린 칸을 돌려줍니다. */
export async function readImageTable(file) {
    const worker = await loadOcrWorker();
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const lines = detectGridLines(pixels, bitmap.width, bitmap.height);
    const { data } = await worker.recognize(bitmap);
    bitmap.close?.();
    const words = wordsOf(data);
    if (lines.xs.length < 3 || lines.ys.length < 3) {
        return { text: clusterTable(words) || String(data?.text || ''), cells: [], clipped: [], weak: true };
    }
    const cells = assignWords(words, lines.xs, lines.ys);
    return { text: cellsToTable(cells), cells, clipped: clippedNotes(cells), weak: false };
}
