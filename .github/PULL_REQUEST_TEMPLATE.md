## Description

<!-- Describe the changes made. If adding an API, list the API name, category, and purpose. -->

Fixes / Closes #(issue number if applicable)

## Type of Change

- [ ] 🚀 New API added to `config/apis.json`
- [ ] 🛠️ Bug fix / correction to an existing API endpoint
- [ ] 🎨 UI / UX dashboard improvement
- [ ] 📖 Documentation update

## Verification Checklist

Please verify the following before submitting your pull request:

- [ ] The API requires **NO registration, API key, or tokens**.
- [ ] The endpoint uses strict **HTTPS** protocol.
- [ ] Ran `node scripts/validate.js` locally and all checks passed.
- [ ] Ran `node scripts/check.js` locally and confirmed the endpoint returned `200 OK` with latency < 1000ms.
- [ ] ID is unique and formatted in `kebab-case`.
- [ ] Category matches one of the approved categories.

## Test Results

<!-- Paste terminal output from `node scripts/check.js` or `node scripts/validate.js` -->
```text

```
