const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');

async function readResponseDetails(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }
  try {
    return await response.text();
  } catch (error) {
    return null;
  }
}

async function getAccessToken() {
  const explicitToken =
    process.env.GOOGLE_ACCESS_TOKEN ||
    process.env.GCP_ACCESS_TOKEN ||
    process.env.VISION_ACCESS_TOKEN ||
    null;

  if (explicitToken) {
    return explicitToken;
  }

  const serviceAccountCredentials = await loadServiceAccountCredentials();
  if (serviceAccountCredentials) {
    return getAccessTokenFromServiceAccount(serviceAccountCredentials);
  }

  return getAccessTokenFromMetadata();
}

async function getAccessTokenFromMetadata() {
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: {
      'Metadata-Flavor': 'Google',
    },
  });

  if (!response.ok) {
    const details = await readResponseDetails(response);
    throw new Error(
      `Unable to resolve Google access token from metadata server (${response.status} ${response.statusText}): ${JSON.stringify(details)}`
    );
  }

  const payload = await response.json();
  if (!payload || !payload.access_token) {
    throw new Error('Google metadata server did not return an access token');
  }

  return payload.access_token;
}

async function loadServiceAccountCredentials() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON || null;
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || null;
  if (!credentialsPath) {
    return null;
  }

  const resolvedPath = path.resolve(credentialsPath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  return JSON.parse(raw);
}

async function getAccessTokenFromServiceAccount(credentials) {
  const privateKey = credentials.private_key;
  const clientEmail = credentials.client_email;
  const tokenUri = credentials.token_uri || OAUTH_TOKEN_URL;

  if (!privateKey || !clientEmail) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON key with private_key and client_email'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
  };
  const payload = {
    iss: clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKey, 'base64url');

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });

  if (!response.ok) {
    const details = await readResponseDetails(response);
    throw new Error(
      `Unable to exchange service account JWT for access token (${response.status} ${response.statusText}): ${JSON.stringify(details)}`
    );
  }

  const tokenResponse = await response.json();
  if (!tokenResponse?.access_token) {
    throw new Error('Service account token exchange did not return an access token');
  }

  return tokenResponse.access_token;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function callGoogleJson(url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await readResponseDetails(response);
    const error = new Error(
      `Google Vision request failed (${response.status} ${response.statusText}): ${JSON.stringify(details)}`
    );
    error.status = response.status;
    error.details = details;
    throw error;
  }

  return response.json();
}

function collectTextFragments(value, fragments = []) {
  if (!value) {
    return fragments;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTextFragments(entry, fragments));
    return fragments;
  }
  if (typeof value !== 'object') {
    return fragments;
  }

  if (typeof value.fullTextAnnotation?.text === 'string' && value.fullTextAnnotation.text.trim()) {
    fragments.push(value.fullTextAnnotation.text.trim());
  }

  if (Array.isArray(value.textAnnotations) && value.textAnnotations[0]?.description) {
    const description = String(value.textAnnotations[0].description).trim();
    if (description) {
      fragments.push(description);
    }
  }

  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'fullTextAnnotation' || key === 'textAnnotations') {
      return;
    }
    if (entry && typeof entry === 'object') {
      collectTextFragments(entry, fragments);
    }
  });

  return fragments;
}

function buildImageAnnotateRequest(gcsUri) {
  return {
    requests: [
      {
        image: {
          source: {
            imageUri: gcsUri,
          },
        },
        features: [
          {
            type: 'DOCUMENT_TEXT_DETECTION',
          },
        ],
      },
    ],
  };
}

function buildFileAnnotateRequest(gcsUri, mimeType) {
  return {
    requests: [
      {
        inputConfig: {
          gcsSource: {
            uri: gcsUri,
          },
          mimeType,
        },
        features: [
          {
            type: 'DOCUMENT_TEXT_DETECTION',
          },
        ],
      },
    ],
  };
}

function extractRawText(responseBody) {
  const fragments = collectTextFragments(responseBody, []);
  return fragments
    .map((fragment) => String(fragment || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function documentTextDetection({ gcsUri, mimeType, fileName }) {
  if (!gcsUri) {
    throw new Error('gcsUri is required for documentTextDetection');
  }

  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const normalizedFileName = String(fileName || '').toLowerCase();
  const isPdf =
    normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf');

  const responseBody = isPdf
    ? await callGoogleJson(
        'https://vision.googleapis.com/v1/files:annotate',
        buildFileAnnotateRequest(gcsUri, 'application/pdf')
      )
    : await callGoogleJson(
        'https://vision.googleapis.com/v1/images:annotate',
        buildImageAnnotateRequest(gcsUri)
      );

  return {
    rawText: extractRawText(responseBody),
    responseBody,
  };
}

function sanitizeErrorMessage(value) {
  if (!value) {
    return 'Unknown Google Vision error';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value.message) {
    return value.message;
  }
  return 'Unknown Google Vision error';
}

module.exports = {
  documentTextDetection,
  extractRawText,
  getAccessToken,
  sanitizeErrorMessage,
};
