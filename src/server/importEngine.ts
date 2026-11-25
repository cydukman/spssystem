import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'data', 'private_uploads');

export function ensureUploadDir(): string {
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
  return UPLOAD_ROOT;
}

export function savePrivateUpload(originalName: string, buffer: Buffer): string {
  const dir = ensureUploadDir();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const targetPath = path.resolve(dir, uniqueName);
  if (!targetPath.startsWith(dir + path.sep)) {
    throw new Error('Invalid file upload path.');
  }
  fs.writeFileSync(targetPath, buffer);
  return uniqueName;
}

export function resolvePrivateUploadPath(storageKey: string): string {
  const dir = ensureUploadDir();
  const safeKey = path.basename(storageKey);
  const resolved = path.resolve(dir, safeKey);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error('Unauthorized file path.');
  }
  return resolved;
}

export interface ParsedSpreadsheetResult {
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Record<string, unknown>>;
  }>;
}

export function parseSpreadsheetBuffer(buffer: Buffer): ParsedSpreadsheetResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      name: sheetName,
      headers,
      rows,
    };
  });
  return { sheets };
}

export interface ExtractedMatrixItem {
  matrix_name: string;
  sampling_point_count: number;
  sampling_points: string;
  parameters: string;
  subcontracted_parameters: string;
  applicable_regulation: string;
}

export interface ExtractedPdfSpsRecord {
  source_page: number;
  document_number: string;
  document_date: string;
  customer_name: string;
  customer_address: string;
  customer_pic: string;
  pic_phone: string;
  job_name: string;
  lhp_number: string;
  sampling_date: string;
  sampling_location: string;
  sampling_personnel: string[];
  sampling_activities: string;
  matrices: ExtractedMatrixItem[];
  notes: string;
  confidence: Record<string, number>;
  missing_fields: string[];
  warnings: string[];
}

export interface PdfTextItem {
  x: number;
  y: number;
  str: string;
}

export interface PdfPageLayout {
  pageNumber: number;
  items: PdfTextItem[];
  text: string;
}

interface SectionBColumnBounds {
  noEnd: number;
  tanggalEnd: number;
  matriksEnd: number;
  jumlahEnd: number;
  titikEnd: number;
  parameterEnd: number;
}

const DEFAULT_ANKAL_COLUMN_BOUNDS: SectionBColumnBounds = {
  noEnd: 62,
  tanggalEnd: 120,
  matriksEnd: 186,
  jumlahEnd: 218,
  titikEnd: 294,
  parameterEnd: 470,
};

function groupItemsIntoLines(items: PdfTextItem[]): Array<{ y: number; items: PdfTextItem[] }> {
  const buckets = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const yBucket = Math.round(item.y / 3) * 3;
    const arr = buckets.get(yBucket) || [];
    arr.push(item);
    buckets.set(yBucket, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, lineItems]) => ({
      y,
      items: [...lineItems].sort((a, b) => a.x - b.x),
    }));
}

function joinCellItems(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3) return dy;
    return a.x - b.x;
  });
  return sorted
    .map((i) => i.str.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanColonValue(raw: string): string {
  return raw.replace(/^:\s*/, '').replace(/\s+/g, ' ').trim();
}

function detectSectionBBoundsFromLine(lineItems: PdfTextItem[]): SectionBColumnBounds | null {
  const findX = (re: RegExp) => lineItems.find((i) => re.test(i.str.trim()))?.x;
  const xNo = findX(/^No\.?$/i);
  const xTanggal = findX(/^Tanggal$/i);
  const xMatriks = findX(/^Matriks$/i);
  const xJumlah = findX(/^Jumlah$/i);
  const xTitik = findX(/Titik/i);
  const xParam = findX(/^Parameter/i);
  const xReg = findX(/^Regulasi/i);

  if (xNo !== undefined && xMatriks !== undefined && xJumlah !== undefined) {
    const noEnd = xTanggal !== undefined ? (xNo + xTanggal) / 2 : 62;
    const tanggalEnd = xMatriks ? ((xTanggal ?? 75) + xMatriks) / 2 : 120;
    const matriksEnd = (xMatriks + xJumlah) / 2;
    const jumlahEnd = xTitik !== undefined ? (xJumlah + xTitik) / 2 : 218;
    // Titik Lokasi ends before x=294 where wide Parameter strings begin; Regulasi starts near x=470
    const titikEnd = 294;
    const parameterEnd = xReg !== undefined ? Math.min(470, (xParam ?? 367) + 105) : 470;
    return { noEnd, tanggalEnd, matriksEnd, jumlahEnd, titikEnd, parameterEnd };
  }
  return null;
}

function extractSectionBRows(
  items: PdfTextItem[],
  topY: number,
  bottomY: number,
  bounds: SectionBColumnBounds
): ExtractedMatrixItem[] {
  const tableItems = items.filter((i) => i.y < topY - 4 && i.y > bottomY + 4 && i.str.trim());
  if (tableItems.length === 0) return [];

  // Identify row anchors via the 'No' column
  const noAnchors = tableItems
    .filter((i) => i.x < bounds.noEnd && /^\d{1,3}$/.test(i.str.trim()))
    .sort((a, b) => b.y - a.y);

  // Deduplicate anchors that sit on nearly identical Y
  const rowCenters: number[] = [];
  for (const a of noAnchors) {
    if (rowCenters.length === 0 || Math.abs(rowCenters[rowCenters.length - 1] - a.y) > 8) {
      rowCenters.push(a.y);
    }
  }

  if (rowCenters.length === 0) {
    return [];
  }

  const rowBuckets: PdfTextItem[][] = rowCenters.map(() => []);
  for (const item of tableItems) {
    if (item.x < bounds.noEnd && /^\d{1,3}$/.test(item.str.trim())) continue;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let r = 0; r < rowCenters.length; r++) {
      const d = Math.abs(item.y - rowCenters[r]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = r;
      }
    }
    rowBuckets[bestIdx].push(item);
  }

  const matrices: ExtractedMatrixItem[] = [];
  for (const bucket of rowBuckets) {
    const tanggalItems: PdfTextItem[] = [];
    const matriksItems: PdfTextItem[] = [];
    const jumlahItems: PdfTextItem[] = [];
    const titikItems: PdfTextItem[] = [];
    const paramItems: PdfTextItem[] = [];
    const regItems: PdfTextItem[] = [];

    for (const item of bucket) {
      if (item.x < bounds.noEnd) continue;
      if (item.x < bounds.tanggalEnd) tanggalItems.push(item);
      else if (item.x < bounds.matriksEnd) matriksItems.push(item);
      else if (item.x < bounds.jumlahEnd) jumlahItems.push(item);
      else if (item.x < bounds.titikEnd) titikItems.push(item);
      else if (item.x < bounds.parameterEnd) paramItems.push(item);
      else regItems.push(item);
    }

    const matrixName = joinCellItems(matriksItems);
    const jumlahStr = joinCellItems(jumlahItems);
    const pointCount = Number.parseInt(jumlahStr.replace(/[^\d]/g, ''), 10) || 1;
    const points = joinCellItems(titikItems);
    const rawParams = joinCellItems(paramItems);
    const regulation = joinCellItems(regItems);

    if (!matrixName && !rawParams && !regulation) continue;

    let parameters = rawParams;
    let subcontractedParameters = '';
    const subMatch = rawParams.match(/(?:Parameter\s+Subkontrak|Subkontrak)\s*:\s*(.+)$/i);
    if (subMatch) {
      subcontractedParameters = subMatch[1].trim();
      parameters = rawParams.slice(0, subMatch.index).trim();
    }

    matrices.push({
      matrix_name: matrixName || 'Umum',
      sampling_point_count: pointCount,
      sampling_points: points || 'Sesuai ketentuan pelanggan',
      parameters: parameters || '-',
      subcontracted_parameters: subcontractedParameters,
      applicable_regulation: regulation || '-',
    });
  }

  return matrices;
}

export function parseAnkalPdfLayout(pages: PdfPageLayout[]): {
  records: ExtractedPdfSpsRecord[];
  scannedPages: number[];
} {
  const records: ExtractedPdfSpsRecord[] = [];
  const scannedPages: number[] = [];
  let lastBounds: SectionBColumnBounds = { ...DEFAULT_ANKAL_COLUMN_BOUNDS };

  for (const page of pages) {
    const text = page.text.trim();
    const spsMatch = text.match(/\b\d{2,4}\/SPS\/[A-Z0-9]+\/[IVX]+\/\d{4}\b/i);
    const docNum = spsMatch ? spsMatch[0].toUpperCase() : '';
    const hasPelangganHeader = /\bPelanggan\b/i.test(text) && /\bNama Pekerjaan\b/i.test(text);
    const isVerySparse = text.length < 150 || page.items.length < 8;

    const lines = groupItemsIntoLines(page.items);

    // Find Section A, Section B, Section C Y-positions
    const secALine = lines.find((l) => /^A\.?\s*$/i.test(l.items[0]?.str.trim() || '') || /JADWAL KEGIATAN/i.test(l.items.map((x) => x.str).join(' ')));
    const secBTitleLine = lines.find((l) => /^B\.?\s*$/i.test(l.items[0]?.str.trim() || '') || /INFORMASI CONTOH UJI/i.test(l.items.map((x) => x.str).join(' ')));
    const secBHeaderLine = lines.find((l) => {
      const joined = l.items.map((x) => x.str).join(' ');
      return /\bNo\b/i.test(joined) && /\bMatriks\b/i.test(joined) && /\bJumlah\b/i.test(joined);
    });
    const secCLine = lines.find((l) => /^C\.?\s*$/i.test(l.items[0]?.str.trim() || '') || /Catatan\s*\/\s*Keterangan/i.test(l.items.map((x) => x.str).join(' ')));
    const footerSignLine = lines.find((l) => /Dibuat Oleh/i.test(l.items.map((x) => x.str).join(' ')));

    if (secBHeaderLine) {
      const detected = detectSectionBBoundsFromLine(secBHeaderLine.items);
      if (detected) lastBounds = detected;
    }

    const tableBottomY = secCLine?.y ?? footerSignLine?.y ?? 20;

    // Continuation page (no header section, merges matrices into previous SPS document — even if short 1-row continuation)
    if (!hasPelangganHeader && !docNum && records.length > 0 && page.items.length >= 4) {
      const bannerYs = lines
        .filter((l) => /\(3 Januari 2023\)|SURAT PENGANTAR PENGAMBILAN|ANKAL-FO-7\.1-01/i.test(l.items.map((x) => x.str).join(' ')))
        .map((l) => l.y);
      const lowestBannerY = bannerYs.length > 0 ? Math.min(...bannerYs) : 800;
      const tableTopY = secBHeaderLine ? secBHeaderLine.y : lowestBannerY - 2;
      const contMatrices = extractSectionBRows(page.items, tableTopY, tableBottomY, lastBounds);
      if (contMatrices.length > 0) {
        const prev = records[records.length - 1];
        prev.matrices.push(...contMatrices);
        prev.missing_fields = prev.missing_fields.filter((f) => f !== 'matrices');
        continue;
      }
    }

    // Sparse / Scanned page handling (e.g. Page 34 with only SPS number selectable)
    if (isVerySparse && !hasPelangganHeader) {
      scannedPages.push(page.pageNumber);
      const missing = ['customer_name', 'job_name', 'matrices'];
      if (!docNum) missing.unshift('document_number');
      records.push({
        source_page: page.pageNumber,
        document_number: docNum,
        document_date: '',
        customer_name: '',
        customer_address: '',
        customer_pic: '',
        pic_phone: '',
        job_name: '',
        lhp_number: '',
        sampling_date: '',
        sampling_location: '',
        sampling_personnel: [],
        sampling_activities: 'Pemantauan Lingkungan',
        matrices: [],
        notes: '',
        confidence: { overall: docNum ? 0.35 : 0.1 },
        missing_fields: missing,
        warnings: [
          `Halaman #${page.pageNumber} terdeteksi sebagai scan/gambar dengan teks terbatas. Periksa atau lengkapi detail sebelum konfirmasi.`,
        ],
      });
      continue;
    }

    // Standard full SPS page
    const headerBottomY = secALine?.y ?? secBTitleLine?.y ?? secBHeaderLine?.y ?? 0;
    const headerLines = lines.filter((l) => l.y > headerBottomY);

    let extractedDocNum = docNum;
    let customerName = '';
    let customerAddress = '';
    let customerPic = '';
    let picPhone = '';
    let jobName = '';
    let lhpNumber = '';
    let samplingDate = '';
    let samplingLocation = '';
    const personnelList: string[] = [];
    let currentHeaderField:
      | 'doc'
      | 'customer'
      | 'address'
      | 'phone'
      | 'contract'
      | 'job'
      | 'date'
      | 'location'
      | 'pic'
      | 'picPhone'
      | 'personnel'
      | null = null;

    for (const line of headerLines) {
      const leftText = line.items
        .filter((i) => i.x < 180)
        .map((i) => i.str.trim())
        .join(' ')
        .trim();
      const rightText = cleanColonValue(
        line.items
          .filter((i) => i.x >= 180)
          .map((i) => i.str.trim())
          .join(' ')
      );

      if (/SURAT PENGANTAR PENGAMBILAN|ANKAL-FO-7\.1-01|\(3 Januari 2023\)/i.test(leftText)) {
        continue;
      }

      if (/No\.\s*Surat Pengantar/i.test(leftText)) {
        currentHeaderField = 'doc';
        if (rightText && !extractedDocNum) extractedDocNum = rightText;
      } else if (/^Pelanggan$/i.test(leftText)) {
        currentHeaderField = 'customer';
        customerName = rightText;
      } else if (/^Alamat$/i.test(leftText)) {
        currentHeaderField = 'address';
        customerAddress = rightText;
      } else if (/^Telp\s*\/\s*Fax$/i.test(leftText)) {
        currentHeaderField = 'phone';
      } else if (/Nomor Perjanjian/i.test(leftText)) {
        currentHeaderField = 'contract';
      } else if (/Nama Pekerjaan/i.test(leftText)) {
        currentHeaderField = 'job';
        jobName = rightText;
        const lhpMatch = rightText.match(/\(([^)]+)\)\s*$/);
        if (lhpMatch) lhpNumber = lhpMatch[1].trim();
      } else if (/Tanggal Pengambilan/i.test(leftText)) {
        currentHeaderField = 'date';
        samplingDate = rightText;
      } else if (/^Lokasi$/i.test(leftText)) {
        currentHeaderField = 'location';
        samplingLocation = rightText;
      } else if (/^Nama Pelanggan$/i.test(leftText)) {
        currentHeaderField = 'pic';
        customerPic = rightText;
      } else if (/No\.\s*PIC Pelanggan/i.test(leftText)) {
        currentHeaderField = 'picPhone';
        picPhone = rightText;
      } else if (/Nama Petugas/i.test(leftText)) {
        currentHeaderField = 'personnel';
        if (rightText && rightText !== '-') personnelList.push(rightText);
      } else if (!leftText && rightText) {
        // Multi-line continuation of the active header field (such as personnel list or wrapped address)
        if (currentHeaderField === 'personnel') {
          if (rightText !== '-') personnelList.push(rightText);
        } else if (currentHeaderField === 'customer') {
          customerName = `${customerName} ${rightText}`.trim();
        } else if (currentHeaderField === 'address') {
          customerAddress = `${customerAddress} ${rightText}`.trim();
        } else if (currentHeaderField === 'location') {
          samplingLocation = `${samplingLocation} ${rightText}`.trim();
        } else if (currentHeaderField === 'job') {
          jobName = `${jobName} ${rightText}`.trim();
        } else if (currentHeaderField === 'date') {
          samplingDate = `${samplingDate} ${rightText}`.trim();
        }
      }
    }

    // Extract Section A activities if available
    let samplingActivities = jobName || 'Pemantauan Lingkungan';
    if (secALine && secBTitleLine) {
      const secALines = lines.filter((l) => l.y < secALine.y - 4 && l.y > secBTitleLine.y + 4);
      const actBody = secALines.filter((l) => !/Hari\s*\/\s*Tanggal/i.test(l.items.map((x) => x.str).join(' ')));
      if (actBody.length > 0) {
        const midItems = actBody[0].items.filter((i) => i.x >= 130 && i.x < 430);
        const actText = joinCellItems(midItems);
        if (actText) samplingActivities = actText;
      }
    }

    const tableTopY = secBHeaderLine?.y ?? secBTitleLine?.y ?? headerBottomY;
    const matrices = extractSectionBRows(page.items, tableTopY, tableBottomY, lastBounds);

    const missingFields: string[] = [];
    if (!extractedDocNum) missingFields.push('document_number');
    if (!customerName) missingFields.push('customer_name');
    if (!jobName) missingFields.push('job_name');
    if (matrices.length === 0) missingFields.push('matrices');

    const warnings: string[] = [];
    if (matrices.length === 0) {
      warnings.push('Tabel matriks contoh uji tidak terdeteksi otomatis; periksa detail secara manual.');
    }

    records.push({
      source_page: page.pageNumber,
      document_number: extractedDocNum,
      document_date: '',
      customer_name: customerName,
      customer_address: customerAddress || samplingLocation,
      customer_pic: customerPic,
      pic_phone: picPhone,
      job_name: jobName || 'Pemantauan Lingkungan',
      lhp_number: lhpNumber,
      sampling_date: samplingDate,
      sampling_location: samplingLocation || customerAddress,
      sampling_personnel: personnelList,
      sampling_activities: samplingActivities,
      matrices,
      notes: '',
      confidence: {
        overall: missingFields.length === 0 ? 0.96 : 0.72,
        document_number: extractedDocNum ? 0.99 : 0.1,
        customer_name: customerName ? 0.98 : 0.1,
      },
      missing_fields: missingFields,
      warnings,
    });
  }

  return { records, scannedPages };
}

export async function extractPdfPagesLayout(buffer: Buffer): Promise<{
  pageCount: number;
  pages: PdfPageLayout[];
}> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableWorker: true,
  } as Record<string, unknown>);
  const pdfDoc = await loadingTask.promise;
  const pages: PdfPageLayout[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of textContent.items) {
      if (raw && typeof raw === 'object' && 'str' in raw && 'transform' in raw) {
        const typed = raw as { str: unknown; transform: number[] };
        const str = String(typed.str || '');
        if (str.trim()) {
          items.push({
            x: Math.round(typed.transform[4] || 0),
            y: Math.round(typed.transform[5] || 0),
            str,
          });
        }
      }
    }
    const lines = groupItemsIntoLines(items);
    const text = lines
      .map((l) => l.items.map((x) => x.str.trim()).join(' '))
      .join('\n')
      .trim();

    pages.push({ pageNumber: i, items, text });
  }

  return { pageCount: pdfDoc.numPages, pages };
}

export async function extractPdfPagesText(buffer: Buffer): Promise<{
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
}> {
  const layout = await extractPdfPagesLayout(buffer);
  return {
    pageCount: layout.pageCount,
    pages: layout.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
  };
}

function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
}

async function runGeminiPdfExtraction(
  pdfBuffer: Buffer,
  filename: string,
  targetPagesNote: string,
  textFallbackDump?: string
): Promise<ExtractedPdfSpsRecord[]> {
  if (!process.env.GEMINI_API_KEY) return [];

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = `You are an expert Indonesian environmental laboratory document parser for PT Analitika Kalibrasi Laboratorium (ANKAL) SPS documents (form ANKAL-FO-7.1-01).
Extract structured SPS records accurately from the provided PDF or extracted PDF text.
CRITICAL RULES:
- NEVER invent or guess missing values. If a field is not present or illegible, return an empty string "" (or 0 / [] as appropriate) and add the field name to missing_fields.
- Multiple consecutive pages belonging to the same SPS (continuation of Section B table) should have their matrices merged into the parent record.
- Extract subcontracted parameters separately if labeled "Parameter Subkontrak:" or similar.
- Return confidence scores between 0.0 and 1.0 for key fields.`;

  const pdfSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        source_page: { type: Type.INTEGER },
        document_number: { type: Type.STRING },
        document_date: { type: Type.STRING },
        customer_name: { type: Type.STRING },
        customer_address: { type: Type.STRING },
        customer_pic: { type: Type.STRING },
        pic_phone: { type: Type.STRING },
        job_name: { type: Type.STRING },
        lhp_number: { type: Type.STRING },
        sampling_date: { type: Type.STRING },
        sampling_location: { type: Type.STRING },
        sampling_personnel: { type: Type.ARRAY, items: { type: Type.STRING } },
        sampling_activities: { type: Type.STRING },
        matrices: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              matrix_name: { type: Type.STRING },
              sampling_point_count: { type: Type.INTEGER },
              sampling_points: { type: Type.STRING },
              parameters: { type: Type.STRING },
              subcontracted_parameters: { type: Type.STRING },
              applicable_regulation: { type: Type.STRING },
            },
          },
        },
        notes: { type: Type.STRING },
        confidence_overall: { type: Type.NUMBER },
        missing_fields: { type: Type.ARRAY, items: { type: Type.STRING } },
        warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
  };

  let rawResultText = '[]';
  if (pdfBuffer.length <= 15 * 1024 * 1024) {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          {
            text: `Extract ANKAL SPS documents from "${filename}". ${targetPagesNote} Only extract text visible in the document; never fabricate missing fields.`,
          },
        ],
      },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: pdfSchema,
      },
    });
    rawResultText = response.text ?? '[]';
  } else if (textFallbackDump) {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Extract ANKAL SPS documents from "${filename}". ${targetPagesNote}\n\n${textFallbackDump}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: pdfSchema,
      },
    });
    rawResultText = response.text ?? '[]';
  }

  let parsed: Array<Record<string, unknown>> = [];
  try {
    parsed = JSON.parse(stripJsonCodeFence(rawResultText));
    if (!Array.isArray(parsed)) parsed = [];
  } catch (err) {
    console.warn('Gemini JSON parse warning during PDF extraction:', err);
    parsed = [];
  }

  return parsed.map((item) => {
    const conf = typeof item.confidence_overall === 'number' ? item.confidence_overall : 0.8;
    const missing = Array.isArray(item.missing_fields) ? item.missing_fields.map(String) : [];
    const docNum = String(item.document_number || '').trim();
    const cust = String(item.customer_name || '').trim();
    if (!docNum && !missing.includes('document_number')) missing.push('document_number');
    if (!cust && !missing.includes('customer_name')) missing.push('customer_name');

    return {
      source_page: Number(item.source_page || 1),
      document_number: docNum,
      document_date: String(item.document_date || ''),
      customer_name: cust,
      customer_address: String(item.customer_address || ''),
      customer_pic: String(item.customer_pic || ''),
      pic_phone: String(item.pic_phone || ''),
      job_name: String(item.job_name || ''),
      lhp_number: String(item.lhp_number || ''),
      sampling_date: String(item.sampling_date || ''),
      sampling_location: String(item.sampling_location || ''),
      sampling_personnel: Array.isArray(item.sampling_personnel)
        ? item.sampling_personnel.map(String)
        : [],
      sampling_activities: String(item.sampling_activities || 'Pemantauan Lingkungan'),
      matrices: Array.isArray(item.matrices)
        ? item.matrices.map((m: Record<string, unknown>) => ({
            matrix_name: String(m.matrix_name || ''),
            sampling_point_count: Number(m.sampling_point_count || 1),
            sampling_points: String(m.sampling_points || ''),
            parameters: String(m.parameters || ''),
            subcontracted_parameters: String(m.subcontracted_parameters || ''),
            applicable_regulation: String(m.applicable_regulation || ''),
          }))
        : [],
      notes: String(item.notes || ''),
      confidence: { overall: conf },
      missing_fields: missing,
      warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : [],
    };
  });
}

export async function extractSpsRecordsFromPdfWithAI(
  pdfBuffer: Buffer,
  filename: string
): Promise<{
  pageCount: number;
  extractionMethod: 'TEXT_AND_AI' | 'MULTIMODAL_AI_OCR' | 'DETERMINISTIC_TEXT_ONLY';
  records: ExtractedPdfSpsRecord[];
}> {
  let pageCount = 1;
  let pages: PdfPageLayout[] = [];

  try {
    const layout = await extractPdfPagesLayout(pdfBuffer);
    pageCount = layout.pageCount;
    pages = layout.pages;
  } catch (err) {
    console.warn('PDF text layout extraction fallback:', err);
  }

  const totalExtractedChars = pages.reduce((acc, p) => acc + p.text.length, 0);
  const isScannedOrEmptyText = totalExtractedChars < 60;

  const { records: deterministicRecords, scannedPages } = parseAnkalPdfLayout(pages);
  const structuredRecordsCount = deterministicRecords.filter(
    (r) => Boolean(r.customer_name) || r.matrices.length > 0
  ).length;

  // Case 1: Purely scanned PDF or non-ANKAL layout -> rely on Gemini Multimodal OCR
  if (isScannedOrEmptyText || structuredRecordsCount === 0) {
    if (!process.env.GEMINI_API_KEY) {
      return {
        pageCount,
        extractionMethod: 'DETERMINISTIC_TEXT_ONLY',
        records:
          deterministicRecords.length > 0
            ? deterministicRecords
            : pages.map((p) => ({
                source_page: p.pageNumber,
                document_number: '',
                document_date: '',
                customer_name: '',
                customer_address: '',
                customer_pic: '',
                pic_phone: '',
                job_name: '',
                lhp_number: '',
                sampling_date: '',
                sampling_location: '',
                sampling_personnel: [],
                sampling_activities: 'Pemantauan Lingkungan',
                matrices: [],
                notes: '',
                confidence: { overall: 0.1 },
                missing_fields: ['document_number', 'customer_name', 'matrices'],
                warnings: [
                  'PDF berupa scan/gambar atau format berbeda dan GEMINI_API_KEY belum tersedia. Lengkapi data secara manual.',
                ],
              })),
      };
    }

    const textDump = pages.map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}`).join('\n\n');
    const aiRecords = await runGeminiPdfExtraction(
      pdfBuffer,
      filename,
      `Extract all SPS documents across all ${pageCount} pages.`,
      textDump
    );
    return {
      pageCount,
      extractionMethod: isScannedOrEmptyText ? 'MULTIMODAL_AI_OCR' : 'TEXT_AND_AI',
      records: aiRecords.length > 0 ? aiRecords : deterministicRecords,
    };
  }

  // Case 2: Digital ANKAL text PDF parsed deterministically; enrich any individual scanned pages via Gemini
  if (scannedPages.length > 0 && process.env.GEMINI_API_KEY) {
    try {
      const aiScanned = await runGeminiPdfExtraction(
        pdfBuffer,
        filename,
        `Focus ONLY on scanned page(s): ${scannedPages.join(', ')}. Extract their exact source_page and complete SPS fields.`
      );
      for (const aiRec of aiScanned) {
        const idx = deterministicRecords.findIndex(
          (r) =>
            scannedPages.includes(r.source_page) &&
            (r.source_page === aiRec.source_page ||
              (r.document_number && r.document_number === aiRec.document_number))
        );
        if (idx !== -1) {
          deterministicRecords[idx] = {
            ...aiRec,
            source_page: deterministicRecords[idx].source_page,
            document_number: aiRec.document_number || deterministicRecords[idx].document_number,
          };
        }
      }
      return {
        pageCount,
        extractionMethod: 'TEXT_AND_AI',
        records: deterministicRecords,
      };
    } catch (err) {
      console.warn('Gemini enrichment for scanned pages failed, keeping deterministic results:', err);
    }
  }

  return {
    pageCount,
    extractionMethod: process.env.GEMINI_API_KEY ? 'TEXT_AND_AI' : 'DETERMINISTIC_TEXT_ONLY',
    records: deterministicRecords,
  };
}
