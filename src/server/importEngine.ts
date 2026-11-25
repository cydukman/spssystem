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
  matrices: Array<{
    matrix_name: string;
    sampling_point_count: number;
    sampling_points: string;
    parameters: string;
    subcontracted_parameters: string;
    applicable_regulation: string;
  }>;
  notes: string;
  confidence: Record<string, number>;
  missing_fields: string[];
  warnings: string[];
}

export async function extractPdfPagesText(buffer: Buffer): Promise<{
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
}> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableWorker: true,
  } as Record<string, unknown>);
  const pdfDoc = await loadingTask.promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const strings = textContent.items
      .map((item: unknown) => {
        if (item && typeof item === 'object' && 'str' in item) {
          return String((item as { str: unknown }).str);
        }
        return '';
      })
      .filter(Boolean);
    pages.push({ pageNumber: i, text: strings.join(' ').trim() });
  }

  return { pageCount: pdfDoc.numPages, pages };
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
  let pages: Array<{ pageNumber: number; text: string }> = [];

  try {
    const textResult = await extractPdfPagesText(pdfBuffer);
    pageCount = textResult.pageCount;
    pages = textResult.pages;
  } catch (err) {
    console.warn('Deterministic PDF text extraction fallback:', err);
  }

  const totalExtractedChars = pages.reduce((acc, p) => acc + p.text.length, 0);
  const isScannedOrEmptyText = totalExtractedChars < 60;

  if (!process.env.GEMINI_API_KEY) {
    // Deterministic regex fallback when GEMINI_API_KEY is not configured
    const fallbackRecords: ExtractedPdfSpsRecord[] = pages.map((p) => {
      const spsMatch = p.text.match(/\b\d{2,4}\/SPS\/[A-Z0-9]+\/[IVX]+\/\d{4}\b/i);
      const custMatch = p.text.match(/Pelanggan\s*:\s*([^:\n]+)/i);
      const docNum = spsMatch ? spsMatch[0] : '';
      const custName = custMatch ? custMatch[1].trim().slice(0, 80) : '';
      const missing: string[] = [];
      if (!docNum) missing.push('document_number');
      if (!custName) missing.push('customer_name');
      missing.push('matrices');
      return {
        source_page: p.pageNumber,
        document_number: docNum,
        document_date: '',
        customer_name: custName,
        customer_address: '',
        customer_pic: '',
        pic_phone: '',
        job_name: 'Pemantauan Lingkungan',
        lhp_number: '',
        sampling_date: '',
        sampling_location: '',
        sampling_personnel: [],
        sampling_activities: 'Pemantauan Lingkungan',
        matrices: [],
        notes: '',
        confidence: { document_number: docNum ? 0.85 : 0.1, customer_name: custName ? 0.6 : 0.1 },
        missing_fields: missing,
        warnings: [
          'Ekstraksi AI tidak aktif (GEMINI_API_KEY belum tersedia). Silakan petakan dan verifikasi data secara manual.',
        ],
      };
    });

    return {
      pageCount,
      extractionMethod: 'DETERMINISTIC_TEXT_ONLY',
      records: fallbackRecords,
    };
  }

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
- Multiple consecutive pages with the same SPS number (e.g. continuation of Section B table on page 2) belong to the same SPS record — merge their matrices cleanly and record the starting source_page.
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

  if (isScannedOrEmptyText || pdfBuffer.length <= 15 * 1024 * 1024) {
    // Send inline PDF directly for highest accuracy on both text and scanned PDFs
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
            text: `Extract all ANKAL SPS documents from "${filename}" (${pageCount} pages). Group multi-page SPS documents by their SPS number. Only extract text visible in the document; never fabricate missing fields.`,
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
  } else {
    const pageDump = pages
      .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}`)
      .join('\n\n');
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Extract all ANKAL SPS documents from "${filename}" text below:\n\n${pageDump}`,
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
    parsed = JSON.parse(rawResultText);
  } catch {
    parsed = [];
  }

  const records: ExtractedPdfSpsRecord[] = parsed.map((item) => {
    const conf = typeof item.confidence_overall === 'number' ? item.confidence_overall : 0.8;
    const missing = Array.isArray(item.missing_fields)
      ? item.missing_fields.map(String)
      : [];
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

  return {
    pageCount,
    extractionMethod: isScannedOrEmptyText ? 'MULTIMODAL_AI_OCR' : 'TEXT_AND_AI',
    records,
  };
}
