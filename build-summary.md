# Build Summary

**Run ID:** 20260720T150031-recurrence-parallelize-embeddings-fix-threshold-split-fix-si

**Status:** ✅ SUCCESS

## Build Details

- **Project:** Pensieve v0.1.0
- **Build Command:** `npm run build`
- **Build Time:** ~846ms
- **Output Directory:** `dist/dashboard/public/`

## Build Artifacts

| Artifact           | Size      | Gzip      |
| ------------------ | --------- | --------- |
| index.html         | 0.40 kB   | 0.27 kB   |
| index-CeVe1Fo1.css | 11.35 kB  | 2.70 kB   |
| index-CWgTC4zX.js  | 399.94 kB | 128.84 kB |

## Steps Completed

1. **TypeScript Compilation:** `tsc -p tsconfig.json` — passed
2. **Vite Build:** `vite build --config src/dashboard/frontend/vite.config.ts` — passed
   - 61 modules transformed
   - Chunks rendered and gzip computed

## Dependencies

- Reinstalled node_modules (412 packages)
- Fixed rollup native module issue (@rollup/rollup-linux-arm64-gnu)

## Notes

- 5 vulnerabilities detected (3 moderate, 1 high, 1 critical) — run `npm audit fix --force` to address if needed
- Build output ready for deployment
