/**
 * app.js
 *
 * FreeAPI Status Client Application (Vanilla ES Modules)
 * - Cache-busting fetch of data/status.json with graceful retry state
 * - Animated count-up metrics & real-time relative timestamps
 * - Dynamic SVG response-time sparklines (gradient fill, hover tooltips)
 * - 48-check uptime history micro-strip
 * - Combined debounced search, category chips, status filter, and sort
 * - Persistent theme toggle (dark/light) via localStorage & CSS custom properties
 * - Full XSS sanitation
 */

// ============================================================================
// 1. Application State & Configuration
// ============================================================================

const state = {
  data: null,
  lastUpdated: null,
  searchQuery: '',
  selectedCategory: 'all',
  selectedStatus: 'all',
  selectedSort: 'latency-asc',
  theme: 'dark'
};

const CONFIG = {
  DATA_URL: 'data/status.json',
  AUTO_REFRESH_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  TIME_TICK_INTERVAL_MS: 15 * 1000,        // 15 seconds
  SEARCH_DEBOUNCE_MS: 150,
  TOTAL_HISTORY_BARS: 48,
  STATUS_COLORS: {
    operational: '#10b981',
    degraded: '#f59e0b',
    down: '#f43f5e',
    empty: 'rgba(255, 255, 255, 0.1)'
  }
};

// ============================================================================
// 2. Utility Functions
// ============================================================================

/**
 * Escapes raw strings for safe HTML interpolation to prevent XSS.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Debounce utility for inputs.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Animates a numeric element from 0 (or previous) to a target value.
 * @param {string} elementId
 * @param {number} targetValue
 * @param {number} duration
 * @param {string} suffix
 */
function animateCountUp(elementId, targetValue, duration = 600, suffix = '') {
  const el = document.getElementById(elementId);
  if (!el || typeof targetValue !== 'number' || isNaN(targetValue)) return;

  const start = 0;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out quadratic curve
    const ease = 1 - (1 - progress) * (1 - progress);
    const current = Math.round(start + (targetValue - start) * ease);

    el.textContent = `${current.toLocaleString()}${suffix}`;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = `${targetValue.toLocaleString()}${suffix}`;
    }
  }

  requestAnimationFrame(tick);
}

/**
 * Converts an ISO date into a human-friendly relative time string.
 * @param {Date} date
 * @returns {string}
 */
function formatRelativeTime(date) {
  if (!date || isNaN(date.getTime())) return 'Recently';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

// ============================================================================
// 3. Theme Controller
// ============================================================================

/**
 * Initializes and binds the light/dark theme toggle.
 */
function initTheme() {
  const saved = localStorage.getItem('freeapi_theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = saved || (systemPrefersDark ? 'dark' : 'light');

  applyTheme(initialTheme);

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem('freeapi_theme', nextTheme);
    });
  }
}

/**
 * Applies theme attribute to <html> root.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
}

// ============================================================================
// 4. Data Fetching & Error Management
// ============================================================================

/**
 * Fetches data/status.json with cache-busting timestamp.
 */
async function fetchStatusData() {
  const cacheBustUrl = `${CONFIG.DATA_URL}?t=${Date.now()}`;
  try {
    const response = await fetch(cacheBustUrl, {
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !payload.apis) {
      throw new Error('Malformed telemetry schema in status.json');
    }

    state.data = payload;
    state.lastUpdated = new Date(payload.last_updated);

    // Update all UI sections
    renderSummary(payload.summary);
    renderHeroBanner(payload.summary);
    updateRelativeTime();
    updateCategoryCounts();
    applyFiltersAndRender();
  } catch (err) {
    console.error('FreeAPI Status Fetch Error:', err);
    renderErrorState(err.message);
  }
}

/**
 * Displays a friendly error banner inside the grid when fetch fails.
 * @param {string} errorMsg
 */
function renderErrorState(errorMsg) {
  const grid = document.getElementById('api-grid');
  const emptyState = document.getElementById('empty-state');
  if (!grid) return;

  if (emptyState) emptyState.style.display = 'none';

  grid.innerHTML = `
    <div class="glass-card" style="grid-column: 1 / -1; padding: 2.5rem; text-align: center;">
      <div style="font-size: 2rem; margin-bottom: 0.75rem;">⚠️</div>
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
        Unable to load status telemetry
      </h3>
      <p style="font-size: 0.9rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.5rem;">
        ${escapeHtml(errorMsg)}. This may happen if the status checker has not completed its first run or if there is a network interruption.
      </p>
      <button id="retry-fetch-btn" class="btn btn--primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        <span>Retry Now</span>
      </button>
    </div>
  `;

  const retryBtn = document.getElementById('retry-fetch-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      grid.innerHTML = `
        <div class="skeleton-card"><div class="skeleton-shimmer skeleton-box"></div></div>
        <div class="skeleton-card"><div class="skeleton-shimmer skeleton-box"></div></div>
        <div class="skeleton-card"><div class="skeleton-shimmer skeleton-box"></div></div>
      `;
      fetchStatusData();
    });
  }
}

// ============================================================================
// 5. Header, Summary & Hero Renderers
// ============================================================================

/**
 * Updates the hero banner reflecting overall system health.
 * @param {Object} summary
 */
function renderHeroBanner(summary) {
  const badge = document.getElementById('system-badge');
  const dot = document.getElementById('system-badge-dot');
  const text = document.getElementById('system-badge-text');
  if (!badge || !dot || !text || !summary) return;

  badge.className = 'system-badge';
  dot.className = 'pulse-dot';

  const downCount = summary.down || 0;
  const degradedCount = summary.degraded || 0;

  if (downCount > 0) {
    badge.classList.add('system-badge--down');
    dot.classList.add('pulse-dot--down');
    text.textContent = downCount === 1 ? '1 System Experiencing Outage' : `${downCount} Systems Experiencing Outages`;
  } else if (degradedCount > 0) {
    badge.classList.add('system-badge--degraded');
    dot.classList.add('pulse-dot--degraded');
    text.textContent = degradedCount === 1 ? '1 System Experiencing Latency' : `${degradedCount} Systems Experiencing Latency`;
  } else {
    badge.classList.add('system-badge--operational');
    dot.classList.add('pulse-dot--operational');
    text.textContent = 'All Systems Operational';
  }
}

/**
 * Updates the 4 glass summary metric cards.
 * @param {Object} summary
 */
function renderSummary(summary) {
  if (!summary) return;

  const total = summary.total_apis ?? summary.total ?? 0;
  const operational = summary.operational ?? 0;
  const degraded = summary.degraded ?? 0;
  const avgLatency = summary.average_response_ms ?? summary.avg_response_ms ?? 0;

  animateCountUp('metric-total', total);
  animateCountUp('metric-operational', operational);
  animateCountUp('metric-degraded', degraded);
  animateCountUp('metric-latency', avgLatency, 650, ' ms');

  const opSub = document.getElementById('metric-operational-sub');
  if (opSub) {
    const pct = total > 0 ? Math.round((operational / total) * 100) : 100;
    opSub.textContent = `${pct}% available`;
  }
}

/**
 * Refreshes the last-updated relative timestamp indicator.
 */
function updateRelativeTime() {
  const timeEl = document.getElementById('last-updated-time');
  if (!timeEl || !state.lastUpdated) return;

  timeEl.textContent = formatRelativeTime(state.lastUpdated);
  timeEl.setAttribute('title', state.lastUpdated.toLocaleString());
}

// ============================================================================
// 6. SVG Sparkline & History Strip Builders
// ============================================================================

/**
 * Builds an inline SVG sparkline representing the last 48 check response times.
 * @param {Array} history
 * @param {string} status ('operational' | 'degraded' | 'down')
 * @param {string} apiId
 * @returns {string} SVG markup string
 */
function buildSparklineSvg(history, status, apiId) {
  const points = (history || [])
    .filter((h) => typeof h.response_ms === 'number' && h.response_ms > 0)
    .map((h) => ({
      ms: h.response_ms,
      timestamp: h.timestamp,
      status: h.status,
      http: h.http_code
    }));

  const width = 280;
  const height = 44;
  const padTop = 6;
  const padBottom = 6;
  const usableHeight = height - padTop - padBottom;

  if (points.length < 2) {
    // Fallback line if not enough historical records exist yet
    const midY = height / 2;
    return `
      <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.3"/>
      </svg>
    `;
  }

  const values = points.map((p) => p.ms);
  const minVal = Math.max(0, Math.min(...values) * 0.85);
  const maxVal = Math.max(...values, minVal + 50);
  const range = maxVal - minVal || 1;

  // Calculate coordinates
  const coords = points.map((pt, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const normalizedY = (pt.ms - minVal) / range;
    const y = height - padBottom - (normalizedY * usableHeight);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), ...pt };
  });

  const pathCommands = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaCommands = `${pathCommands} L ${width} ${height} L 0 ${height} Z`;

  const color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.operational;
  const gradientId = `grad-${escapeHtml(apiId)}`;

  // Interactive hover dots on the sparkline
  const dotsHtml = coords.map((c) => `
    <circle 
      class="sparkline-dot" 
      cx="${c.x}" 
      cy="${c.y}" 
      r="2" 
      fill="${color}"
      data-timestamp="${escapeHtml(c.timestamp)}"
      data-status="${escapeHtml(c.status)}"
      data-ms="${c.ms}"
      data-http="${escapeHtml(c.http ?? '200')}"
    />
  `).join('');

  return `
    <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Response latency sparkline">
      <defs>
        <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <path d="${areaCommands}" fill="url(#${gradientId})" />
      <path class="sparkline-path sparkline-path--${status}" d="${pathCommands}" />
      ${dotsHtml}
    </svg>
  `;
}

/**
 * Builds the 48-bar uptime strip markup for an API card.
 * @param {Array} history
 * @returns {string} HTML markup string
 */
function buildUptimeStripHtml(history = []) {
  const total = CONFIG.TOTAL_HISTORY_BARS;
  const list = history.slice(-total);
  const missingCount = Math.max(0, total - list.length);

  let barsHtml = '';

  // Pad historical intervals with empty placeholders if fewer than 48 exist
  for (let i = 0; i < missingCount; i++) {
    barsHtml += `<div class="history-bar history-bar--empty" data-status="empty" aria-label="No data for interval"></div>`;
  }

  // Render recorded check bars
  for (const item of list) {
    const st = item.status || 'operational';
    barsHtml += `
      <div 
        class="history-bar history-bar--${escapeHtml(st)}" 
        data-status="${escapeHtml(st)}"
        data-timestamp="${escapeHtml(item.timestamp)}"
        data-ms="${item.response_ms ?? ''}"
        data-http="${escapeHtml(item.http_code ?? '')}"
        tabindex="0"
      ></div>
    `;
  }

  return `
    <div class="api-card__history-header">
      <span>48-Hour Availability Strip</span>
      <span>${list.length} / 48 recorded</span>
    </div>
    <div class="history-sparkline" role="group" aria-label="Hourly availability timeline">
      ${barsHtml}
    </div>
  `;
}

// ============================================================================
// 7. API Card Renderer & Grid Assembler
// ============================================================================

/**
 * Creates HTML for an individual API card.
 * @param {Object} api
 * @param {number} index
 * @returns {string}
 */
function createApiCardHtml(api, index = 0) {
  const statusClass = `status-pill--${api.status}`;
  const pulseClass = `pulse-dot--${api.status}`;
  const displayStatus = api.status === 'operational'
    ? 'Operational'
    : (api.status === 'degraded' ? 'Degraded' : 'Down');

  const responseMsDisplay = api.response_ms != null ? `${api.response_ms}ms` : 'Timeout';
  const httpCodeDisplay = api.http_code != null ? `HTTP ${api.http_code}` : 'No Code';
  const uptimeDisplay = typeof api.uptime_24h === 'number' ? `${api.uptime_24h}%` : '100%';

  const sparklineSvg = buildSparklineSvg(api.history, api.status, api.id);
  const uptimeStrip = buildUptimeStripHtml(api.history);

  const cleanUrl = escapeHtml(api.url);
  const cleanDocsUrl = escapeHtml(api.docs_url || api.url);

  return `
    <article 
      class="glass-card api-card" 
      data-id="${escapeHtml(api.id)}" 
      data-category="${escapeHtml(api.category)}"
      role="button"
      tabindex="0"
      aria-label="View telemetry details for ${escapeHtml(api.name)}"
      style="--card-index: ${index};"
    >
      <div>
        <div class="api-card__top">
          <div class="api-card__heading">
            <span class="api-card__category">${escapeHtml(api.category)}</span>
            <h2 class="api-card__title">${escapeHtml(api.name)}</h2>
          </div>
          <div class="status-pill ${statusClass}">
            <span class="pulse-dot ${pulseClass}" aria-hidden="true"></span>
            <span>${displayStatus}</span>
          </div>
        </div>

        <!-- Metrics Row -->
        <div class="api-card__metrics">
          <div class="metric-col">
            <span class="metric-col__label">Response</span>
            <span class="metric-col__val">${responseMsDisplay}</span>
          </div>
          <div class="metric-col">
            <span class="metric-col__label">24h Uptime</span>
            <span class="metric-col__val">${uptimeDisplay}</span>
          </div>
          <div class="metric-col">
            <span class="metric-col__label">Status</span>
            <span class="metric-col__val">${httpCodeDisplay}</span>
          </div>
        </div>

        <!-- Sparkline Wrapper -->
        <div class="api-card__sparkline-wrapper">
          <div class="api-card__sparkline-header">
            <span>Latency Trend (Last 48 Checks)</span>
            <span>${responseMsDisplay}</span>
          </div>
          <div class="sparkline-box">
            ${sparklineSvg}
          </div>
        </div>

        <!-- 48-Bar Uptime Strip -->
        ${uptimeStrip}
      </div>

      <!-- Card Footer Actions -->
      <div class="api-card__footer">
        <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="endpoint-link" title="Test endpoint URL: ${cleanUrl}" onclick="event.stopPropagation()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <span>${cleanUrl}</span>
        </a>
        <a href="${cleanDocsUrl}" target="_blank" rel="noopener noreferrer" class="docs-link" title="Read official API documentation" onclick="event.stopPropagation()">
          <span>Docs</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="7" y1="17" x2="17" y2="7"></line>
            <polyline points="7 7 17 7 17 17"></polyline>
          </svg>
        </a>
      </div>
    </article>
  `;
}

// ============================================================================
// 8. Tooltip Controller
// ============================================================================

/**
 * Initializes hover listener for bars and sparkline dots using event delegation.
 */
function initTooltip() {
  const tooltip = document.getElementById('history-tooltip');
  const grid = document.getElementById('api-grid');
  if (!tooltip || !grid) return;

  grid.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.history-bar, .sparkline-dot');
    if (!target) return;

    const status = target.dataset.status;
    if (!status || status === 'empty') {
      tooltip.querySelector('.history-tooltip__status').textContent = 'Interval Unrecorded';
      tooltip.querySelector('.history-tooltip__time').textContent = 'Prior to telemetry tracking';
      tooltip.querySelector('.history-tooltip__metric').textContent = '';
      showTooltip(tooltip, target);
      return;
    }

    const timestamp = target.dataset.timestamp ? new Date(target.dataset.timestamp) : null;
    const ms = target.dataset.ms ? `${target.dataset.ms} ms` : 'N/A';
    const http = target.dataset.http ? `HTTP ${target.dataset.http}` : '';

    const statusLabel = status.toUpperCase();
    const timeFormatted = timestamp ? timestamp.toLocaleString() : 'Unknown';

    tooltip.querySelector('.history-tooltip__status').textContent = `${statusLabel}`;
    tooltip.querySelector('.history-tooltip__time').textContent = timeFormatted;
    tooltip.querySelector('.history-tooltip__metric').textContent = `${ms} ${http ? '• ' + http : ''}`;

    showTooltip(tooltip, target);
  });

  grid.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.history-bar, .sparkline-dot');
    if (target) {
      tooltip.classList.remove('is-active');
    }
  });
}

/**
 * Positions and displays the floating tooltip element near the hovered target.
 * @param {HTMLElement} tooltip
 * @param {HTMLElement} target
 */
function showTooltip(tooltip, target) {
  const rect = target.getBoundingClientRect();
  const tipX = rect.left + rect.width / 2;
  const tipY = rect.top;

  tooltip.style.left = `${Math.round(tipX)}px`;
  tooltip.style.top = `${Math.round(tipY)}px`;
  tooltip.classList.add('is-active');
}

// ============================================================================
// 9. Filters, Search & Sorting Engine
// ============================================================================

/**
 * Applies search, category chips, status filter, and sorting.
 */
function applyFiltersAndRender() {
  if (!state.data || !Array.isArray(state.data.apis)) return;

  const apis = state.data.apis;
  const query = state.searchQuery.trim().toLowerCase();
  const category = state.selectedCategory;
  const status = state.selectedStatus;
  const sort = state.selectedSort;

  // 1. Filter
  let filtered = apis.filter((api) => {
    // Category match
    if (category !== 'all' && api.category !== category) return false;

    // Status match
    if (status !== 'all' && api.status !== status) return false;

    // Search query match
    if (query) {
      const matchName = api.name.toLowerCase().includes(query);
      const matchCat = api.category.toLowerCase().includes(query);
      const matchUrl = api.url.toLowerCase().includes(query);
      if (!matchName && !matchCat && !matchUrl) return false;
    }

    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    switch (sort) {
      case 'latency-asc':
        return (a.response_ms ?? 999999) - (b.response_ms ?? 999999);
      case 'latency-desc':
        return (b.response_ms ?? -1) - (a.response_ms ?? -1);
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'uptime-desc':
        return (b.uptime_24h ?? 0) - (a.uptime_24h ?? 0);
      case 'uptime-asc':
        return (a.uptime_24h ?? 0) - (b.uptime_24h ?? 0);
      default:
        return 0;
    }
  });

  // 3. Render into DOM
  const grid = document.getElementById('api-grid');
  const emptyState = document.getElementById('empty-state');
  const countMeta = document.getElementById('results-count');

  if (countMeta) {
    if (filtered.length === apis.length) {
      countMeta.textContent = `Showing all ${apis.length} monitored APIs`;
    } else {
      countMeta.textContent = `Showing ${filtered.length} of ${apis.length} APIs`;
    }
  }

  if (filtered.length === 0) {
    if (grid) grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
  } else {
    if (grid) {
      grid.style.display = 'grid';
      grid.innerHTML = filtered.map((api, idx) => createApiCardHtml(api, idx)).join('');
    }
    if (emptyState) emptyState.style.display = 'none';
  }
}

/**
 * Updates count indicators inside the category filter chips.
 */
function updateCategoryCounts() {
  if (!state.data || !Array.isArray(state.data.apis)) return;

  const countAll = document.getElementById('count-all');
  if (countAll) {
    countAll.textContent = state.data.apis.length;
  }
}

/**
 * Binds event handlers for all toolbar controls (search, chips, dropdowns, shortcuts).
 */
function initControls() {
  // 1. Search Box & Debounce
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  if (searchInput) {
    const handleSearch = debounce((e) => {
      state.searchQuery = e.target.value;
      if (searchClear) {
        searchClear.style.display = state.searchQuery ? 'block' : 'none';
      }
      applyFiltersAndRender();
    }, CONFIG.SEARCH_DEBOUNCE_MS);

    searchInput.addEventListener('input', handleSearch);

    // Keyboard shortcut '/' to focus search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.value = '';
        state.searchQuery = '';
        if (searchClear) searchClear.style.display = 'none';
        searchInput.blur();
        applyFiltersAndRender();
      }
    });
  }

  // Clear button inside search input
  if (searchClear && searchInput) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      searchClear.style.display = 'none';
      searchInput.focus();
      applyFiltersAndRender();
    });
  }

  // 2. Category Chips
  const chipContainer = document.getElementById('category-chips');
  if (chipContainer) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      const category = chip.dataset.category;
      if (!category) return;

      chipContainer.querySelectorAll('.chip').forEach((c) => {
        c.classList.remove('chip--active');
        c.setAttribute('aria-checked', 'false');
      });

      chip.classList.add('chip--active');
      chip.setAttribute('aria-checked', 'true');

      state.selectedCategory = category;
      applyFiltersAndRender();
    });
  }

  // 3. Status Filter Dropdown
  const statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      state.selectedStatus = e.target.value;
      applyFiltersAndRender();
    });
  }

  // 4. Sort Selector Dropdown
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.selectedSort = e.target.value;
      applyFiltersAndRender();
    });
  }

  // 5. Reset Filters Button in Empty State
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedCategory = 'all';
      state.selectedStatus = 'all';
      state.selectedSort = 'latency-asc';

      if (searchInput) {
        searchInput.value = '';
        if (searchClear) searchClear.style.display = 'none';
      }
      if (statusFilter) statusFilter.value = 'all';
      if (sortSelect) sortSelect.value = 'latency-asc';

      if (chipContainer) {
        chipContainer.querySelectorAll('.chip').forEach((c) => {
          const isAll = c.dataset.category === 'all';
          c.classList.toggle('chip--active', isAll);
          c.setAttribute('aria-checked', isAll ? 'true' : 'false');
        });
      }

      applyFiltersAndRender();
    });
  }
}

// ============================================================================
// 10. Telemetry Detail Modal & Badge Generation
// ============================================================================

let activeModalApi = null;

/**
 * Initializes listeners for modal open/close, card clicks, and keyboard events.
 */
function initModal() {
  const grid = document.getElementById('api-grid');
  const modal = document.getElementById('detail-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const copyBadgeBtn = document.getElementById('modal-copy-badge-btn');
  const copyUrlBtn = document.getElementById('modal-copy-url-btn');

  if (!modal) return;

  // Click card to open modal
  if (grid) {
    grid.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return; // Ignore direct clicks on links
      const card = e.target.closest('.api-card');
      if (!card) return;

      const apiId = card.dataset.id;
      const api = state.data?.apis?.find((a) => a.id === apiId);
      if (api) openModal(api);
    });

    // Keyboard support: Enter / Space to open modal
    grid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.api-card');
        if (card && document.activeElement === card) {
          e.preventDefault();
          const apiId = card.dataset.id;
          const api = state.data?.apis?.find((a) => a.id === apiId);
          if (api) openModal(api);
        }
      }
    });
  }

  // Close button click
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // Backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Native ESC key handler
  modal.addEventListener('cancel', () => {
    activeModalApi = null;
  });

  // Copy Status Badge
  if (copyBadgeBtn) {
    copyBadgeBtn.addEventListener('click', () => {
      if (activeModalApi) copyStatusBadge(activeModalApi);
    });
  }

  // Copy Endpoint URL
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      if (activeModalApi?.url) {
        navigator.clipboard.writeText(activeModalApi.url).then(() => {
          showToast('Endpoint URL copied to clipboard!');
        });
      }
    });
  }
}

/**
 * Opens and populates the telemetry detail modal dialog.
 * @param {Object} api
 */
function openModal(api) {
  const modal = document.getElementById('detail-modal');
  if (!modal) return;
  activeModalApi = api;

  // Header
  const titleEl = document.getElementById('modal-api-name');
  const catEl = document.getElementById('modal-api-category');
  const badgeEl = document.getElementById('modal-status-badge');
  const dotEl = document.getElementById('modal-status-dot');
  const textEl = document.getElementById('modal-status-text');

  if (titleEl) titleEl.textContent = api.name;
  if (catEl) catEl.textContent = api.category;

  if (badgeEl && dotEl && textEl) {
    badgeEl.className = `status-pill status-pill--${api.status}`;
    dotEl.className = `pulse-dot pulse-dot--${api.status}`;
    textEl.textContent = api.status.charAt(0).toUpperCase() + api.status.slice(1);
  }

  // Calculate telemetry aggregates from history
  const validLatencies = (api.history || [])
    .map((h) => h.response_ms)
    .filter((ms) => typeof ms === 'number' && ms > 0);

  const minMs = validLatencies.length > 0 ? Math.min(...validLatencies) : 'N/A';
  const maxMs = validLatencies.length > 0 ? Math.max(...validLatencies) : 'N/A';
  const avgMs = validLatencies.length > 0
    ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
    : 'N/A';

  const minEl = document.getElementById('modal-stat-min');
  const avgEl = document.getElementById('modal-stat-avg');
  const maxEl = document.getElementById('modal-stat-max');
  const uptimeEl = document.getElementById('modal-stat-uptime');
  const chartBadge = document.getElementById('modal-chart-latest');

  if (minEl) minEl.textContent = minMs !== 'N/A' ? `${minMs}ms` : '--';
  if (avgEl) avgEl.textContent = avgMs !== 'N/A' ? `${avgMs}ms` : '--';
  if (maxEl) maxEl.textContent = maxMs !== 'N/A' ? `${maxMs}ms` : '--';
  if (uptimeEl) uptimeEl.textContent = typeof api.uptime_24h === 'number' ? `${api.uptime_24h}%` : '100%';
  if (chartBadge) chartBadge.textContent = api.response_ms != null ? `Latest: ${api.response_ms}ms` : 'Latest: Timeout';

  // Render high-res SVG chart
  const chartContainer = document.getElementById('modal-chart-container');
  if (chartContainer) {
    chartContainer.innerHTML = buildModalChartSvg(api.history, api.status, api.id, minMs, maxMs, avgMs);
  }

  // Docs link
  const docsLink = document.getElementById('modal-docs-link');
  if (docsLink) {
    docsLink.href = api.docs_url || api.url;
  }

  modal.showModal();
}

/**
 * Closes the detail modal.
 */
function closeModal() {
  const modal = document.getElementById('detail-modal');
  if (modal && modal.open) {
    modal.close();
  }
  activeModalApi = null;
}

/**
 * Builds an expanded high-resolution SVG chart for the modal view.
 */
function buildModalChartSvg(history, status, apiId, minMs, maxMs, avgMs) {
  const points = (history || [])
    .filter((h) => typeof h.response_ms === 'number' && h.response_ms > 0)
    .map((h) => ({ ms: h.response_ms, time: h.timestamp }));

  const W = 620;
  const H = 140;
  const padTop = 16;
  const padBottom = 24;
  const padLeft = 45;
  const padRight = 20;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  if (points.length < 2) {
    return `
      <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.85rem;">
        Insufficient historical data recorded yet (minimum 2 hourly checks required)
      </div>
    `;
  }

  const values = points.map((p) => p.ms);
  const minVal = typeof minMs === 'number' ? Math.max(0, minMs * 0.8) : Math.min(...values);
  const maxVal = typeof maxMs === 'number' ? maxMs * 1.15 : Math.max(...values);
  const range = maxVal - minVal || 1;

  const coords = points.map((pt, idx) => {
    const x = padLeft + (idx / (points.length - 1)) * innerW;
    const y = H - padBottom - ((pt.ms - minVal) / range) * innerH;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), ...pt };
  });

  const pathCommands = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaCommands = `${pathCommands} L ${coords[coords.length - 1].x} ${H - padBottom} L ${coords[0].x} ${H - padBottom} Z`;

  const color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.operational;
  const gradId = `modal-grad-${escapeHtml(apiId)}`;

  // Average line calculation
  const avgY = typeof avgMs === 'number'
    ? Number((H - padBottom - ((avgMs - minVal) / range) * innerH).toFixed(1))
    : H / 2;

  return `
    <svg class="modal-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.38" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Baseline and Average Reference Gridlines -->
      <line x1="${padLeft}" y1="${H - padBottom}" x2="${W - padRight}" y2="${H - padBottom}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
      <line x1="${padLeft}" y1="${avgY}" x2="${W - padRight}" y2="${avgY}" stroke="rgba(255,255,255,0.18)" stroke-dasharray="4 4" stroke-width="1" />
      <text x="${padLeft - 8}" y="${avgY + 4}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">${avgMs}ms</text>
      <text x="${padLeft - 8}" y="${H - padBottom + 3}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">0ms</text>

      <!-- Shaded Area and Telemetry Curve -->
      <path d="${areaCommands}" fill="url(#${gradId})" />
      <path d="${pathCommands}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Data Points -->
      ${coords.map((c) => `
        <circle cx="${c.x}" cy="${c.y}" r="3" fill="${color}" stroke="var(--bg-canvas)" stroke-width="1.5" />
      `).join('')}
    </svg>
  `;
}

/**
 * Copies a Shields.io markdown status badge for the selected API.
 * @param {Object} api
 */
function copyStatusBadge(api) {
  const colorMap = {
    operational: '10b981',
    degraded: 'f59e0b',
    down: 'f43f5e'
  };
  const colorHex = colorMap[api.status] || '10b981';
  const nameEncoded = encodeURIComponent(api.name);
  const statusEncoded = encodeURIComponent(api.status);

  const badgeMarkdown = `[![${api.name} Status](https://img.shields.io/badge/${nameEncoded}-${statusEncoded}-${colorHex}?style=flat-square&logo=statuspage)](https://freeapi-status.github.io)`;

  navigator.clipboard.writeText(badgeMarkdown).then(() => {
    showToast(`Badge Markdown copied for ${api.name}!`);
  }).catch(() => {
    showToast('Failed to copy badge. Please copy manually.');
  });
}

/**
 * Dispatches a lightweight floating toast notification.
 * @param {string} message
 */
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-message--closing');
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}

// ============================================================================
// 11. Bootstrap Application
// ============================================================================

function bootstrap() {
  initTheme();
  initControls();
  initTooltip();
  initModal();
  fetchStatusData();

  // Periodic live relative time updater (e.g. "Updated 2 minutes ago")
  setInterval(updateRelativeTime, CONFIG.TIME_TICK_INTERVAL_MS);

  // Periodic automatic re-fetch of telemetry data every 5 minutes
  setInterval(fetchStatusData, CONFIG.AUTO_REFRESH_INTERVAL_MS);
}

// Kick off when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
