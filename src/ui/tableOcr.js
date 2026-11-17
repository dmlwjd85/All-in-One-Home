/**
 * 표 사진을 기기 안에서 읽습니다. 사진은 저장하지 않고 어디로도 보내지 않습니다.
 *
 * 읽는 길
 *  1. 사진에서 표의 가로·세로 선을 찾아 칸으로 나눕니다(lib/tableImage.js). 조금 기운 사진은 바로 세웁니다.
 *  2. 칸마다 선을 지우고 글자를 키워 세로로 이어 붙인 긴 그림을 만들어 한 번에 읽습니다.
 *     (표 전체를 통째로 읽으면 선과 옆 칸 글자가 섞여 날짜와 메뉴가 어긋납니다.)
 *  3. 읽힌 줄을 위치로 다시 칸에 돌려 놓습니다.
 *  선을 못 찾은 사진은 통째로 읽은 뒤 낱말 위치로 칸을 짐작합니다(정확도가 낮아 화면에서 알려 줍니다).
 *
 * 글자 인식 프로그램(작업자·코어)과 한국어 자료는 이 앱과 같은 주소(./ocr/)에서 받습니다.
 * 다른 회사 서버에 기대지 않고, 한 번 받은 뒤에는 인터넷이 없어도 읽습니다.
 */
import { cellsToTable, clusterTable } from '../lib/gridDetect.js';
import { joinHangulSpaces } from '../lib/hangulFix.js';
import { placeLines, prepareTable } from '../lib/tableImage.js';

/* 휴대폰 사진(긴 변 4000px 안팎)을 2600px 로 줄이면 한 달 급식표의 작은 글자가 뭉개져 잘못 읽힙니다.
   메모리가 넉넉한 기기에서는 원래 크기에 가깝게 두고, 적은 기기(2GB 이하)만 예전처럼 줄입니다. */
export function maxSide(memory = globalThis.navigator?.deviceMemory) {
    return Number(memory) > 0 && Number(memory) <= 2 ? 2600 : 4000;
}
let workerPromise = null;
let listener = null;

function ocrBase() {
    return new URL('ocr', globalThis.document?.baseURI || globalThis.location?.href).href.replace(/\/$/, '');
}

export function loadOcrWorker() {
    if (!workerPromise) {
        const base = ocrBase();
        workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('kor', 1, {
            workerPath: `${base}/worker.min.js`,
            corePath: base,
            langPath: base,
            logger: (message) => { try { listener?.(message); } catch { /* 진행 표시가 실패해도 읽기는 이어갑니다. */ } },
        })).catch((error) => {
            workerPromise = null; /* 받다가 끊겼으면 다음에 다시 받습니다. */
            throw new Error(`언어 자료를 받지 못했어요. ${error?.message || ''}`.trim());
        });
    }
    return workerPromise;
}

/** 사진 파일을 그림판(canvas)에 올립니다. 너무 큰 사진은 줄입니다. 휴대폰 사진의 방향 정보를 따릅니다. */
async function decode(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        bitmap = await createImageBitmap(file);
    }
    const scale = Math.min(1, maxSide() / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { canvas, ctx, width, height };
}

function stripCanvas(strip) {
    const canvas = document.createElement('canvas');
    canvas.width = strip.width;
    canvas.height = strip.height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(strip.width, strip.height);
    const out = image.data;
    for (let i = 0, p = 0; i < strip.data.length; i += 1, p += 4) {
        const v = strip.data[i];
        out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

function linesOf(data) {
    const lines = data?.lines || (data?.blocks || []).flatMap((block) => (block.paragraphs || []).flatMap((para) => para.lines || []));
    return (lines || []).map((line) => ({
        text: joinHangulSpaces(String(line.text || '').trim()),
        y0: line.bbox?.y0 ?? 0,
        y1: line.bbox?.y1 ?? 0,
        conf: line.confidence,
    }));
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

/**
 * 사진 파일에서 표 글(탭으로 나눈 글)을 돌려줍니다.
 * 돌려줌: { text, cells, clipped, weak, doubt, small } — weak 는 칸 선을 못 찾아 짐작으로 나눈 경우, doubt 는 흐리게 읽힌 줄 수,
 * small 은 글자가 너무 작게 찍힌 경우입니다.
 * onProgress(글) 로 지금 무엇을 하는지 알려 줍니다.
 */
export async function readImageTable(file, onProgress = () => {}) {
    onProgress('사진에서 표의 칸을 찾고 있어요.');
    const { canvas, ctx, width, height } = await decode(file);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const prep = prepareTable(pixels, width, height);
    listener = (message) => {
        if (message?.status && message.status !== 'recognizing text') onProgress('글자 읽는 프로그램을 준비하고 있어요. 처음 한 번만 받습니다.');
    };
    let worker;
    try {
        worker = await loadOcrWorker();
    } finally {
        listener = null;
    }
    if (!prep.ok) {
        onProgress('칸 선이 잘 안 보여 통째로 읽고 있어요.');
        await worker.setParameters({ tessedit_pageseg_mode: '3' });
        const { data } = await worker.recognize(canvas);
        return { text: joinHangulSpaces(clusterTable(wordsOf(data)) || String(data?.text || '')), cells: [], clipped: [], weak: true, doubt: 0 };
    }
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    let doubt = 0;
    for (let i = 0; i < prep.strips.length; i += 1) {
        onProgress(prep.strips.length > 1 ? `글자를 읽고 있어요 (${i + 1}/${prep.strips.length}).` : '글자를 읽고 있어요.');
        const strip = prep.strips[i];
        const { data } = await worker.recognize(stripCanvas(strip));
        const lines = linesOf(data);
        doubt += lines.filter((line) => line.text && Number(line.conf) < 60).length;
        placeLines(prep.cells, strip.bands, lines);
    }
    const text = cellsToTable(prep.cells);
    /* 글자 높이가 9점 아래면 사진이 작거나 멀리서 찍힌 것이라 잘못 읽은 글자가 많습니다. */
    return { text, cells: prep.cells, clipped: [], weak: !text.trim(), doubt, small: Boolean(prep.glyph) && prep.glyph < 10 };
}
