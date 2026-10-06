/**
 * scripts/validate.js
 *
 * Pull Request configuration validator for config/apis.json.
 * Ensures data integrity, unique identifiers, strict HTTPS protocol,
 * and valid schema definitions before merging new APIs.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = resolve(__dirname, '..', 'config', 'apis.json');

const ID_REGEX = /^[a-z0-9-]+$/;
const ALLOWED_CATEGORIES = new Set([
  'Weather',
  'Fun',
  'Finance',
  'Dev Tools',
  'Geo',
  'Data',
  'AI & ML',
  'Science'
]);

async function validate() {
  console.log('🔍 Validating config/apis.json registry...');
  let rawContent;
  try {
    rawContent = await readFile(CONFIG_PATH, 'utf-8');
  } catch (err) {
    console.error(`❌ Failed to read ${CONFIG_PATH}:`, err.message);
    process.exit(1);
  }

  let apis;
  try {
    apis = JSON.parse(rawContent);
  } catch (parseErr) {
    console.error('❌ Invalid JSON syntax in config/apis.json:\n', parseErr.message);
    process.exit(1);
  }

  if (!Array.isArray(apis) || apis.length === 0) {
    console.error('❌ config/apis.json must contain a non-empty array of API objects.');
    process.exit(1);
  }

  const seenIds = new Set();
  const seenUrls = new Set();
  const errors = [];

  apis.forEach((entry, index) => {
    const prefix = `[Entry #${index + 1} (${entry.name || 'Unnamed'})]:`;

    // 1. Required fields
    const requiredKeys = ['id', 'name', 'category', 'url', 'expected_status', 'timeout_ms', 'docs_url'];
    for (const key of requiredKeys) {
      if (entry[key] === undefined || entry[key] === null || entry[key] === '') {
        errors.push(`${prefix} Missing required property "${key}".`);
      }
    }

    // 2. ID validation
    if (entry.id) {
      if (!ID_REGEX.test(entry.id)) {
        errors.push(`${prefix} ID "${entry.id}" must be kebab-case (lowercase letters, numbers, and dashes only).`);
      }
      if (seenIds.has(entry.id)) {
        errors.push(`${prefix} Duplicate ID detected: "${entry.id}". All IDs must be unique.`);
      }
      seenIds.add(entry.id);
    }

    // 3. Category validation
    if (entry.category && !ALLOWED_CATEGORIES.has(entry.category)) {
      errors.push(`${prefix} Invalid category "${entry.category}". Allowed categories: ${Array.from(ALLOWED_CATEGORIES).join(', ')}.`);
    }

    // 4. URL validation (must be HTTPS)
    if (entry.url) {
      try {
        const parsed = new URL(entry.url);
        if (parsed.protocol !== 'https:') {
          errors.push(`${prefix} URL must use HTTPS protocol (${entry.url}).`);
        }
        if (seenUrls.has(entry.url)) {
          errors.push(`${prefix} Duplicate test URL detected: "${entry.url}".`);
        }
        seenUrls.add(entry.url);
      } catch {
        errors.push(`${prefix} Malformed URL string "${entry.url}".`);
      }
    }

    // 5. Documentation URL validation
    if (entry.docs_url) {
      try {
        const parsedDocs = new URL(entry.docs_url);
        if (parsedDocs.protocol !== 'https:') {
          errors.push(`${prefix} Documentation URL must use HTTPS (${entry.docs_url}).`);
        }
      } catch {
        errors.push(`${prefix} Malformed docs_url "${entry.docs_url}".`);
      }
    }

    // 6. Expected HTTP status
    if (typeof entry.expected_status !== 'number' || entry.expected_status < 200 || entry.expected_status > 299) {
      errors.push(`${prefix} expected_status must be a 2xx HTTP status code (received ${entry.expected_status}).`);
    }

    // 7. Timeout validation
    if (typeof entry.timeout_ms !== 'number' || entry.timeout_ms < 1000 || entry.timeout_ms > 15000) {
      errors.push(`${prefix} timeout_ms must be a number between 1000ms and 15000ms (received ${entry.timeout_ms}).`);
    }
  });

  if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} error(s):`);
    errors.forEach((err) => console.error(`  • ${err}`));
    process.exit(1);
  }

  console.log(`✅ All ${apis.length} API definitions in config/apis.json are valid, unique, and HTTPS secured!\n`);
}

validate().catch((err) => {
  console.error('Fatal validator error:', err);
  process.exit(1);
});
