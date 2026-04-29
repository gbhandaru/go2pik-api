const pool = require('../config/db');

function mapMenuImport(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    fileUrl: row.file_url,
    fileType: row.file_type,
    status: row.status,
    rawOcrText: row.raw_ocr_text,
    correctedOcrText: row.corrected_ocr_text,
    correctionNotes: row.correction_notes,
    parsedJson: row.parsed_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createMenuImport(fields, db = pool) {
  const query = `
    INSERT INTO menu_imports (
      restaurant_id,
      file_url,
      file_type,
      status,
      raw_ocr_text,
      corrected_ocr_text,
      correction_notes,
      parsed_json,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *;
  `;
  const values = [
    fields.restaurantId,
    fields.fileUrl,
    fields.fileType,
    fields.status || 'UPLOADED',
    fields.rawOcrText || null,
    fields.correctedOcrText === undefined ? null : fields.correctedOcrText,
    fields.correctionNotes === undefined ? null : fields.correctionNotes,
    fields.parsedJson === undefined ? null : fields.parsedJson,
    fields.errorMessage || null,
  ];
  const { rows } = await db.query(query, values);
  return mapMenuImport(rows[0]);
}

async function updateMenuImport(id, fields, db = pool) {
  const allowed = [
    'restaurant_id',
    'file_url',
    'file_type',
    'status',
    'raw_ocr_text',
    'corrected_ocr_text',
    'correction_notes',
    'parsed_json',
    'error_message',
  ];
  const updates = [];
  const values = [];

  allowed.forEach((field) => {
    if (fields[field] !== undefined) {
      values.push(fields[field]);
      updates.push(`${field} = $${values.length}`);
    }
  });

  if (updates.length === 0) {
    const { rows } = await db.query('SELECT * FROM menu_imports WHERE id = $1 LIMIT 1;', [id]);
    return mapMenuImport(rows[0]);
  }

  values.push(id);
  const query = `
    UPDATE menu_imports
    SET ${updates.join(', ')}, updated_at = now()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await db.query(query, values);
  return mapMenuImport(rows[0]);
}

async function getMenuImportById(id, db = pool) {
  const query = `
    SELECT
      id,
      restaurant_id,
      file_url,
      file_type,
      status,
      raw_ocr_text,
      corrected_ocr_text,
      correction_notes,
      parsed_json,
      error_message,
      created_at
    FROM menu_imports
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await db.query(query, [id]);
  return mapMenuImport(rows[0]);
}

module.exports = {
  createMenuImport,
  updateMenuImport,
  getMenuImportById,
  mapMenuImport,
};
