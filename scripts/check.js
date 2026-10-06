/**
 * scripts/check.js
 *
 * Health-check runner for FreeAPI Status dashboard.
 * - Node.js 20+ native ES module (zero external dependencies)
 * - Concurrent checks with AbortController timeout & custom User-Agent
 * - Single-retry on failure before declaring an outage
 * - Rolling 48-entry historical timeline with 24-hour uptime rollup
 * - Generates public data/status.json artifact
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Resolve directory paths relative to script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT_DIR, 'config', 'apis.json');
const DATA_DIR = resolve(ROOT_DIR, 'data');
const STATUS_PATH = resolve(DATA_DIR, 'status.json');

// Configuration Constants
const USER_AGENT = 'FreeAPIStatus/1.0 (+https://github.com/freeapi-status; health-checker)';
const DEFAULT_TIMEOUT_MS = 8000;
const DEGRADED_LATENCY_THRESHOLD_MS = 1000;
const RETRY_BACKOFF_MS = 1000;
const MAX_HISTORY_LENGTH = 48;
const UPTIME_WINDOW_CHECKS = 24;

/**
 * Utility helper for pausing between retries.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Performs a single HTTP GET request to test API responsiveness.
 *
 * @param {Object} target API definition
 * @returns {Promise<{
 *   status: 'operational' | 'degraded' | 'down',
 *   response_ms: number | null,
 *   http_code: number | null,
 *   error?: string
 * }>}
 */
async function executePing(target) {
  const timeoutMs = target.timeout_ms || DEFAULT_TIMEOUT_MS;
  const expectedStatus = target.expected_status || 200;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = performance.now();

  try {
    const response = await fetch(target.url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      },
      signal: controller.signal
    });

    // Safely drain/cancel body to prevent open socket leaks in Node undici
    try {
      if (response.body && typeof response.body.cancel === 'function') {
        await response.body.cancel();
      }
    } catch {
      // Ignore stream cancellation quirks
    }

    const durationMs = Math.round(performance.now() - startTime);

    if (response.status === expectedStatus) {
      const isSlow = durationMs >= DEGRADED_LATENCY_THRESHOLD_MS;
      return {
        status: isSlow ? 'degraded' : 'operational',
        response_ms: durationMs,
        http_code: response.status
      };
    }

    return {
      status: 'down',
      response_ms: durationMs,
      http_code: response.status,
      error: `Expected HTTP ${expectedStatus}, received ${response.status}`
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    return {
      status: 'down',
      response_ms: null,
      http_code: null,
      error: isTimeout ? `Timeout exceeded (${timeoutMs}ms)` : (err.message || 'Network error')
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks an API target with a single retry on failure.
 *
 * @param {Object} target
 * @returns {Promise<{
 *   status: 'operational' | 'degraded' | 'down',
 *   response_ms: number | null,
 *   http_code: number | null,
 *   retried: boolean,
 *   error?: string
 * }>}
 */
async function checkWithRetry(target) {
  // First attempt
  const firstAttempt = await executePing(target);
  if (firstAttempt.status !== 'down') {
    return { ...firstAttempt, retried: false };
  }

  // Failed first attempt - wait and retry once before declaring outage
  await sleep(RETRY_BACKOFF_MS);
  const secondAttempt = await executePing(target);

  return {
    ...secondAttempt,
    retried: true,
    error: secondAttempt.status === 'down'
      ? (secondAttempt.error || firstAttempt.error)
      : undefined
  };
}

/**
 * Reads and parses existing data/status.json safely.
 * Returns null if file is missing, empty, or unparseable.
 *
 * @returns {Promise<Object | null>}
 */
async function loadPreviousStatus() {
  try {
    const raw = await readFile(STATUS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Main execution routine.
 */
async function run() {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 [${timestamp}] Starting FreeAPI Status check batch...`);

  // 1. Read targets from config/apis.json
  let targetApis = [];
  try {
    const configRaw = await readFile(CONFIG_PATH, 'utf-8');
    targetApis = JSON.parse(configRaw);
  } catch (err) {
    console.error(`❌ Failed to read configuration from ${CONFIG_PATH}:`, err.message);
    process.exit(1);
  }

  // 2. Load previous snapshot for historical continuity
  const previousData = await loadPreviousStatus();
  const previousMap = new Map();
  if (previousData?.apis && Array.isArray(previousData.apis)) {
    for (const prev of previousData.apis) {
      if (prev.id) previousMap.set(prev.id, prev);
    }
  }

  // 3. Concurrently inspect all registered APIs
  const checkPromises = targetApis.map(async (api) => {
    try {
      const result = await checkWithRetry(api);
      return { api, result };
    } catch (unexpectedErr) {
      // Catch-all safety guard so a single failure never crashes the batch
      return {
        api,
        result: {
          status: 'down',
          response_ms: null,
          http_code: null,
          retried: true,
          error: unexpectedErr.message || 'Unexpected exception'
        }
      };
    }
  });

  const checkResults = await Promise.all(checkPromises);

  // 4. Construct updated API list with rolling 48-entry history and 24h uptime
  const updatedApis = [];
  const tableRows = [];

  for (const { api, result } of checkResults) {
    const prevEntry = previousMap.get(api.id);
    const existingHistory = Array.isArray(prevEntry?.history) ? prevEntry.history : [];

    // Current check record
    const currentCheck = {
      timestamp,
      status: result.status,
      response_ms: result.response_ms,
      http_code: result.http_code
    };

    // Rolling history trimmed to last 48 entries (48 hours of hourly checks)
    const history = [...existingHistory, currentCheck].slice(-MAX_HISTORY_LENGTH);

    // Calculate 24h uptime (over the most recent 24 checks)
    const recentWindow = history.slice(-UPTIME_WINDOW_CHECKS);
    const upChecksCount = recentWindow.filter((h) => h.status !== 'down').length;
    const uptime24h = recentWindow.length > 0
      ? Number(((upChecksCount / recentWindow.length) * 100).toFixed(1))
      : (result.status === 'down' ? 0.0 : 100.0);

    updatedApis.push({
      id: api.id,
      name: api.name,
      category: api.category,
      url: api.url,
      docs_url: api.docs_url,
      status: result.status,
      response_ms: result.response_ms,
      http_code: result.http_code,
      uptime_24h: uptime24h,
      history
    });

    tableRows.push({
      Name: api.name,
      Category: api.category,
      Status: result.status.toUpperCase(),
      HTTP: result.http_code ?? 'ERR',
      'Latency (ms)': result.response_ms ?? 'N/A',
      'Uptime 24h': `${uptime24h}%`,
      Retry: result.retried ? 'YES' : 'NO',
      Notes: result.error || 'OK'
    });
  }

  // 5. Aggregate summary stats
  const operationalCount = updatedApis.filter((a) => a.status === 'operational').length;
  const degradedCount = updatedApis.filter((a) => a.status === 'degraded').length;
  const downCount = updatedApis.filter((a) => a.status === 'down').length;

  const validLatencies = updatedApis
    .map((a) => a.response_ms)
    .filter((ms) => typeof ms === 'number' && ms > 0);

  const avgLatency = validLatencies.length > 0
    ? Math.round(validLatencies.reduce((acc, curr) => acc + curr, 0) / validLatencies.length)
    : 0;

  let systemStatus = 'all_operational';
  if (downCount > 0 || degradedCount > 0) {
    const isMajor = downCount >= Math.max(2, Math.ceil(updatedApis.length * 0.25));
    systemStatus = isMajor ? 'major_outage' : 'partial_outage';
  }

  const payload = {
    last_updated: timestamp,
    summary: {
      total_apis: updatedApis.length,
      total: updatedApis.length,
      operational: operationalCount,
      degraded: degradedCount,
      down: downCount,
      average_response_ms: avgLatency,
      avg_response_ms: avgLatency,
      system_status: systemStatus
    },
    apis: updatedApis
  };

  // 6. Ensure target directory exists and commit data/status.json
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATUS_PATH, JSON.stringify(payload, null, 2), 'utf-8');

  // 7. Output clean console summary table
  console.log(`\n📊 Batch Results (${updatedApis.length} APIs monitored):`);
  console.table(tableRows);

  console.log('📈 Summary Overview:');
  console.log(`   • Overall Status : ${systemStatus}`);
  console.log(`   • Operational    : ${operationalCount} / ${updatedApis.length}`);
  console.log(`   • Degraded       : ${degradedCount}`);
  console.log(`   • Down           : ${downCount}`);
  console.log(`   • Avg Latency    : ${avgLatency} ms`);
  console.log(`💾 Successfully updated ${STATUS_PATH}\n`);
}

run().catch((fatalErr) => {
  console.error('💥 Fatal error in check execution script:', fatalErr);
  process.exit(1);
});
