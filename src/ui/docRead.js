/** 고른 파일(사진·한글·PDF)을 종류에 맞게 읽습니다. 모두 이 기기 안에서만 풉니다. */
import { fileKind, readHwp, readHwpx } from '../lib/docFile.js';

export const DOC_ACCEPT = '.hwp,.hwpx,.pdf,application/pdf,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/vnd.hancom.hwpx,image/*';
export const DOC_MAX_BYTES = 30 * 1024 * 1024;

/**
 * 돌려주는 값: { kind: 'image'|'hwp'|'hwpx'|'pdf', text, image } — image 가 있으면 사진 읽기로 넘깁니다.
 * 못 읽으면 { kind, error: 'big'|'locked'|'old'|'unknown'|'read' }.
 */
export async function readDocFile(file) {
    if (!file) return { kind: '', error: 'unknown' };
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const kind = fileKind(file.name, head);
    if (kind === 'image') return { kind, text: '', image: file };
    if (!kind) return { kind, error: 'unknown' };
    if (file.size > DOC_MAX_BYTES) return { kind, error: 'big' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
        if (kind === 'hwp') return { kind, text: await readHwp(bytes), image: null };
        if (kind === 'hwpx') return { kind, text: await readHwpx(bytes), image: null };
        const { readPdf } = await import('./pdfText.js');
        const pdf = await readPdf(bytes);
        return { kind, text: pdf.text, image: pdf.image, pages: pdf.pages };
    } catch (error) {
        const why = String(error?.message || error || '');
        if (/locked|password/i.test(why)) return { kind, error: 'locked' };
        if (/not-compound|not-hwp|unsupported/.test(why)) return { kind, error: 'old' };
        return { kind, error: 'read' };
    }
}

export const DOC_ERROR = {
    big: '파일이 너무 커요(30MB까지). 급식표 쪽만 따로 저장해 주세요.',
    locked: '암호가 걸렸거나 배포용으로 잠긴 파일은 읽지 못해요. 암호를 풀어 저장하거나 화면을 찍어 넣어 주세요.',
    old: '이 한글 파일 형식은 읽지 못해요. 한글에서 PDF로 저장하거나 화면을 찍어 넣어 주세요.',
    unknown: '사진·한글(hwp·hwpx)·PDF 파일만 읽을 수 있어요.',
    read: '이 파일을 읽지 못했어요. PDF로 저장해 보거나 화면을 찍어 넣어 주세요.',
};
