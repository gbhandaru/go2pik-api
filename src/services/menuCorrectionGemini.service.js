const { GoogleGenAI, Type } = require('@google/genai');

const MAX_OCR_INPUT_LENGTH = 200000;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const SYSTEM_INSTRUCTIONS = [
  'You correct obvious OCR mistakes in restaurant menu text.',
  'Return only the JSON payload that matches the requested schema.',
  'Do not include commentary, markdown, code fences, or explanations.',
  'Preserve the original menu meaning and structure as much as possible.',
  'Do not invent new food items, prices, or categories.',
  'Do not add missing menu items.',
  'Do not remove valid menu content.',
  'Keep prices exactly as shown unless the OCR clearly misread a symbol or digit.',
  'Only correct obvious spelling errors and OCR character mistakes.',
  'If the text does not look like a menu, return the original text unchanged and add a warning.',
].join(' ');

const CORRECTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    correctedText: {
      type: Type.STRING,
      description: 'The corrected OCR text.',
    },
    corrections: {
      type: Type.ARRAY,
      description: 'List of obvious OCR corrections that were applied.',
      items: {
        type: Type.OBJECT,
        properties: {
          original: {
            type: Type.STRING,
            description: 'Original OCR fragment.',
          },
          corrected: {
            type: Type.STRING,
            description: 'Corrected OCR fragment.',
          },
          reason: {
            type: Type.STRING,
            description: 'Reason for the correction.',
          },
        },
        required: ['original', 'corrected', 'reason'],
        additionalProperties: false,
      },
    },
    warnings: {
      type: Type.ARRAY,
      description: 'Warnings about OCR quality or menu uncertainty.',
      items: {
        type: Type.STRING,
      },
    },
  },
  required: ['correctedText', 'corrections', 'warnings'],
  additionalProperties: false,
};

let cachedClient = null;

function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('GEMINI_API_KEY is required');
  }

  cachedClient = new GoogleGenAI({ apiKey: String(apiKey).trim() });
  return cachedClient;
}

function validateInput(rawOcrText) {
  if (typeof rawOcrText !== 'string') {
    throw new Error('rawOcrText must be a string');
  }

  const trimmed = rawOcrText.trim();
  if (!trimmed) {
    throw new Error('rawOcrText cannot be empty');
  }

  if (trimmed.length > MAX_OCR_INPUT_LENGTH) {
    throw new Error(`rawOcrText exceeds maximum length of ${MAX_OCR_INPUT_LENGTH} characters`);
  }

  return trimmed;
}

function buildPrompt(rawOcrText) {
  return [
    SYSTEM_INSTRUCTIONS,
    '',
    'Correct the OCR text below while preserving the original menu meaning.',
    'Return the text in the same general layout, but fix obvious OCR mistakes only.',
    'OCR TEXT START',
    rawOcrText,
    'OCR TEXT END',
  ].join('\n');
}

function extractCandidateText(response) {
  if (!response) {
    return '';
  }

  if (typeof response.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }

  const candidateParts =
    response.candidates?.[0]?.content?.parts ||
    response.response?.candidates?.[0]?.content?.parts ||
    [];

  if (Array.isArray(candidateParts)) {
    const text = candidateParts
      .map((part) => {
        if (!part) return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.inlineData?.data === 'string') return part.inlineData.data;
        return '';
      })
      .join('');
    if (text.trim()) {
      return text.trim();
    }
  }

  if (typeof response.candidates?.[0]?.content?.parts?.[0]?.text === 'string') {
    return response.candidates[0].content.parts[0].text.trim();
  }

  return '';
}

function stripCodeFences(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function extractJsonSubstring(text) {
  const cleaned = stripCodeFences(text);
  if (!cleaned) {
    return cleaned;
  }

  const firstObject = cleaned.indexOf('{');
  const firstArray = cleaned.indexOf('[');
  const start =
    firstObject === -1
      ? firstArray
      : firstArray === -1
        ? firstObject
        : Math.min(firstObject, firstArray);

  if (start === -1) {
    return cleaned;
  }

  const candidate = cleaned.slice(start);
  const endObject = candidate.lastIndexOf('}');
  const endArray = candidate.lastIndexOf(']');
  const end = Math.max(endObject, endArray);
  if (end === -1) {
    return candidate;
  }

  return candidate.slice(0, end + 1);
}

function safeJsonParse(text) {
  const candidate = extractJsonSubstring(text);
  if (!candidate) {
    throw new Error('Gemini returned an empty response');
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const normalized = candidate
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/:\s*undefined\b/g, ': null');
    try {
      return JSON.parse(normalized);
    } catch (secondError) {
      throw new Error('Gemini returned invalid JSON');
    }
  }
}

function normalizeCorrectionPayload(payload, rawOcrText) {
  const corrections = Array.isArray(payload?.corrections) ? payload.corrections : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const correctedText =
    typeof payload?.correctedText === 'string' && payload.correctedText.trim()
      ? payload.correctedText.trim()
      : rawOcrText;

  return {
    correctedText,
    corrections: corrections
      .map((entry) => {
        const original = typeof entry?.original === 'string' ? entry.original.trim() : '';
        const corrected = typeof entry?.corrected === 'string' ? entry.corrected.trim() : '';
        const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';

        if (!original || !corrected || !reason) {
          return null;
        }

        return {
          original,
          corrected,
          reason,
        };
      })
      .filter(Boolean),
    warnings: warnings
      .map((warning) => (typeof warning === 'string' ? warning.trim() : ''))
      .filter(Boolean),
  };
}

async function correctMenuOcrText(rawOcrText) {
  const cleanedInput = validateInput(rawOcrText);
  const client = getClient();
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const response = await client.models.generateContent({
    model,
    contents: buildPrompt(cleanedInput),
    config: {
      temperature: 0,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: CORRECTION_SCHEMA,
    },
  });

  const responseText = extractCandidateText(response);
  if (!responseText) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = safeJsonParse(responseText);
  return normalizeCorrectionPayload(parsed, cleanedInput);
}

module.exports = {
  correctMenuOcrText,
};
