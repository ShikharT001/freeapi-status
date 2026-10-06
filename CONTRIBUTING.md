# Contributing to FreeAPI Status

Thank you for your interest in contributing to **FreeAPI Status**! We welcome community contributions to help monitor and benchmark the world's most useful free APIs.

---

## 🌟 Criteria for Adding an API

To ensure high quality, reliability, and security for the developer community, every API added to `config/apis.json` must meet these conditions:

1. **100% Free & Keyless**: No registration, no API key, and no authorization headers required.
2. **Strict HTTPS**: Endpoints must resolve securely over `https://`.
3. **Lightweight GET Endpoint**: Endpoints should be small health checks, pings, or sample queries (prefer responses under 50 KB).
4. **Permissive Public Usage**: Must have public fair-use allowances and not aggressive rate limits (e.g. at least 60 requests/hour).
5. **Standard 200 OK**: Must consistently return HTTP `200` under healthy conditions.

---

## 🚀 Step-by-Step Pull Request Flow

### 1. Fork and Clone
```bash
git clone https://github.com/<your-username>/freeapi-status.git
cd freeapi-status
```

### 2. Add Your Entry to `config/apis.json`
Open `config/apis.json` and append your API following this exact structure:

```json
{
  "id": "my-cool-api",
  "name": "My Cool API",
  "category": "Weather",
  "url": "https://api.example.com/v1/ping",
  "expected_status": 200,
  "timeout_ms": 8000,
  "docs_url": "https://example.com/docs"
}
```

#### Allowed Categories:
* `Weather`
* `Fun`
* `Finance`
* `Dev Tools`
* `Geo`
* `Data`
* `AI & ML`
* `Science`

### 3. Validate Schema & Test Health Checks
Run the built-in zero-dependency validator and health check runner:

```bash
# 1. Verify schema, uniqueness, and HTTPS compliance
node scripts/validate.js

# 2. Perform a live synthetic test check
node scripts/check.js
```

Ensure both commands succeed with exit code `0`.

### 4. Commit and Push
Follow Conventional Commits:

```bash
git checkout -b feat/add-my-cool-api
git commit -m "feat(api): add My Cool API"
git push origin feat/add-my-cool-api
```

### 5. Open a Pull Request
* Open a PR on GitHub against the `main` branch.
* Complete the Pull Request checklist.
* Our automated GitHub Actions workflow will validate your JSON schema and URL security automatically.

---

## 🎨 Improving Dashboard UI & Client Code

* **Zero Dependencies**: Do not introduce npm packages, build tools, or runtime dependencies. Keep the architecture static (`index.html`, `style.css`, `app.js`).
* **Semantic & Accessible**: Ensure all interactive elements retain ARIA roles, high-contrast focus rings, and screen-reader accessibility.
* **Format**: Keep code clean, modern ES2022+ modules, and well-commented.

Thank you for helping keep public APIs transparent and reliable!
