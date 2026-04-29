const { GoogleGenAI, Type } = require('@google/genai');

const MAX_OCR_INPUT_LENGTH = 200000;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const SYSTEM_INSTRUCTIONS = [
  'You extract restaurant menu structure from OCR text.',
  'Return only the JSON payload that matches the requested schema.',
  'Do not include commentary, markdown, code fences, or explanations.',
  'Do not hallucinate menu items, categories, or prices.',
  'Only use information explicitly present in the OCR text.',
  'Ignore noise such as QR text, ads, slogans, addresses, phone numbers, social media handles, and boilerplate.',
  'If the OCR text appears to be a flyer, ad, QR page, app promotion, or otherwise does not contain clear menu item plus price pairs, return an empty categories array.',
  'Do not create sample menu items.',
  'Only extract items that literally appear in the OCR text.',
  'Every extracted item must have direct evidence in the OCR text.',
  'If a price is missing or uncertain, set it to null.',
  'If item description is missing, set it to null.',
  'If vegetarian status is uncertain, set it to null.',
  'Clean item and category names by removing stray punctuation and OCR artifacts while preserving the original meaning.',
].join(' ');

const MENU_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    categories: {
      type: Type.ARRAY,
      description: 'Menu categories found in the OCR text.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Category name.',
          },
          items: {
            type: Type.ARRAY,
            description: 'Menu items in the category.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: {
                  type: Type.STRING,
                  description: 'Menu item name.',
                },
                description: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Short item description or null when absent.',
                },
                price: {
                  type: Type.NUMBER,
                  nullable: true,
                  description: 'Menu item price or null when absent.',
                },
                isVegetarian: {
                  type: Type.BOOLEAN,
                  nullable: true,
                  description: 'True, false, or null when uncertain.',
                },
              },
              required: ['name', 'description', 'price', 'isVegetarian'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['categories'],
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
    'Extract the restaurant menu from the OCR text below.',
    'If there are no clear menu item + price pairs, output { "categories": [] }.',
    'Output must follow this schema exactly:',
    '{ "categories": [ { "name": string, "items": [ { "name": string, "description": string|null, "price": number|null, "isVegetarian": boolean|null } ] } ] }',
    '',
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

function cleanText(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-•*|:;,.]+/g, '')
    .replace(/[\s\-•*|:;,.]+$/g, '')
    .trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', 'vegetarian', 'veg'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', 'non-vegetarian', 'nonvegetarian', 'meat'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function normalizeParsedMenu(payload) {
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];

  return {
    categories: categories
      .map((category) => {
        const items = Array.isArray(category?.items) ? category.items : [];
        const cleanedItems = items
          .map((item) => {
            const name = cleanText(item?.name);
            if (!name) {
              return null;
            }

            return {
              name,
              description: cleanText(item?.description || '') || null,
              price: normalizeNumber(item?.price),
              isVegetarian: normalizeBoolean(item?.isVegetarian),
            };
          })
          .filter(Boolean);

        const categoryName = cleanText(category?.name);
        if (!categoryName || cleanedItems.length === 0) {
          return null;
        }

        return {
          name: categoryName,
          items: cleanedItems,
        };
      })
      .filter(Boolean),
  };
}

async function parseMenuFromOcr(rawOcrText) {
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
      responseSchema: MENU_SCHEMA,
    },
  });

  const responseText = extractCandidateText(response);
  if (!responseText) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = safeJsonParse(responseText);
  const normalized = normalizeParsedMenu(parsed);

  return normalized;
}

module.exports = {
  parseMenuFromOcr,
};
