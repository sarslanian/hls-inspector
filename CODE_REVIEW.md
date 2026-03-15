# HLS Inspector — Full Code Review

**Scope:** Frontend-only React app (Vite, TypeScript, Tailwind, shadcn-style UI, hls.js). No backend.

---

## 1. Project structure & entry points

| Path | Purpose |
|------|--------|
| `src/main.tsx` | Entry: StrictMode, createRoot, mounts `App` and `index.css`. |
| `src/App.tsx` | Single app component: views (streams / issues / inspect), state, handlers, all UI. |
| `src/store.ts` | Stream CRUD, localStorage persistence, `runInspect` orchestration, types. |
| `src/lib/inspect.ts` | Fetch manifests, parse (via m3u8), health checks, SCTE-35 extraction. |
| `src/lib/m3u8.ts` | Master/media playlist parsing, EXT-X-MEDIA, EXT-X-KEY, EXT-X-MAP, fallback caption parse. |
| `src/components/HlsPlayer.tsx` | HLS.js playlist mode + single-segment (blob m3u8) mode, autoplay, error state. |
| `src/components/ui/*` | button, card, input, label, select, tabs — shadcn-style. |

**Verdict:** Clear separation: UI in App + components, domain logic in lib + store. Entry and build (vite.config, `@/` alias) are correct.

---

## 2. Strengths

- **Types:** `Stream`, `InspectResult`, `FetchResult`, `MediaPlaylistResult`, etc. are defined and used consistently. No `any` in core flow.
- **HLS behavior:** Master vs media detection, URI resolution, variant sort by bandwidth, media sequence, target duration, segments, encryption/init segment, segment format (ts/fmp4) — all aligned with common HLS usage.
- **Health checks:** Staleness, discontinuity, segment duration, cross-rendition (segment count and media sequence with tolerance), HTTP/media errors. Segment count mismatch only when delta > 2.
- **SCTE-35:** CUE-OUT/CUE-IN, DATERANGE, OATCLS; ad duration vs actual computed where possible.
- **Captions:** Main parse + lenient `parseExtXMediaFromRaw` fallback; master and media-playlist-only flows both feed the Captions tab.
- **Single-segment playback:** Blob m3u8 with one segment fed to HLS.js so .ts and .m4s both play; blob URL revoked on cleanup.
- **UX:** Dark theme, consistent borders, fixed player aspect so variant change doesn’t resize, validation and error messages, variant selectors for segments and playlist.

---

## 3. Bugs & fixes to consider

### 3.1 `loadDetail` doesn’t reset playlist variant index

When opening a stream, `selectedPlaylistVariantIndex` is not reset. If you had “Variant 3” selected in the Playlist tab for stream A, then open stream B, the Playlist tab can show an out-of-range or wrong variant until the user changes it.

**Fix:** In `loadDetail`, add `setSelectedPlaylistVariantIndex(0)` (alongside the existing segment index reset).

### 3.2 Duplicate condition in `codecLabels` (App.tsx)

```ts
else if (c.startsWith("mp4a") || c.startsWith("mp4a")) audio = "AAC"
```

Second condition is redundant. Can be `c.startsWith("mp4a")` only.

### 3.3 Poll loop swallows errors

```ts
} catch (_) {}
```

A failing stream never updates state and leaves the UI stale. Prefer: set that stream’s state to error (e.g. via a small helper or `streamStateFromResult` with an error result) or at least log.

### 3.4 List keys

- **Issues list:** `key={i}` — reordering/trimming can cause unnecessary re-renders or focus issues. Prefer a stable key, e.g. `${e.stream_id}-${e.at}-${e.kind}-${i}` or a hash of the message.
- **Segment table:** `key={displayIndex}` is good (stable per segment).
- **SCTE-35 / captions / overview events:** Index keys are acceptable for static lists; consider stable keys if lists are reordered or filtered later.

---

## 4. Security & data

- No secrets in repo; URLs are user input and stored in localStorage. README mentions CORS.
- `validateHlsUrl` enforces HTTP(S) and “m3u8” in path; no script injection via URL in the app.
- External segment/playlist URLs are loaded by the browser (video, fetch); same-origin and CORS apply. No raw HTML injection from manifest content in the UI (only text in `<pre>` or table cells).

**Verdict:** Appropriate for a client-only inspector; no server-side or auth concerns.

---

## 5. Performance

- **Polling:** All streams polled sequentially every 10s. For many streams, consider capping concurrency (e.g. 2–3 at a time) or increasing interval.
- **Bundle:** Single chunk (~760KB); README already suggests code-splitting for large apps. Acceptable for this tool.
- **HlsPlayer:** Blob URL and HLS instance cleaned up in effect teardown; no obvious leaks.
- **App state:** Many `useState` values; could migrate to a reducer or a small store later if logic grows, but current size is manageable.

---

## 6. Accessibility

- Buttons and links are focusable; no `tabIndex` hacks.
- **Gaps:** No `aria-label` on icon-only or ambiguous controls (e.g. “Back”, “Remove”, “Download”, segment row click). Tabs use role from Radix/shadcn pattern; if using native tabs, ensure `role="tablist"` / `role="tab"` / `role="tabpanel"` and `aria-selected` / `aria-controls` where applicable.
- **Video:** `muted` and `playsInline` support autoplay; consider exposing a “Unmute” affordance for accessibility.
- **Errors:** Segment and validation errors are visible text; could add `aria-live="polite"` on the error region for screen readers.

---

## 7. Maintainability & style

- **App.tsx size:** ~780 lines and holds all views and handlers. Consider splitting: e.g. `StreamsView`, `IssuesView`, `InspectView` (and within it, Overview/Segments/Captions/SCTE-35/Playlist as subcomponents or sections). Would improve readability and testing.
- **Magic numbers:** `POLL_INTERVAL_MS`, `MAX_EVENTS`, “last 30” segments, `min-h-[4.5rem]`, `max-h-[70vh]` — could move to a small `constants.ts` or theme config.
- **Inline download logic:** Playlist “Download as .txt” is inline in JSX. Could extract `downloadBlobAsFile(blob, filename)` and reuse for segments if needed.
- **Tailwind:** Consistent use of design tokens (`border-border`, `text-muted-foreground`, etc.). No obvious duplication that needs abstraction at this stage.

---

## 8. Testing & robustness

- **Parsing:** No unit tests for `parseMaster`, `parseMedia`, `parseExtXMediaFromRaw`, or `runHealthChecks`. Malformed or edge-case manifests could throw or produce odd UI; tests would lock behavior and help refactors.
- **Store:** `loadStreams` / `saveStreams` handle parse errors; `runInspect` maps fetch result and catches exceptions. Good.
- **HlsPlayer:** Handles missing `video` ref, no src, and HLS.js unsupported; segment mode cleans up blob and HLS. Solid.

---

## 9. Dependencies

- **package.json:** React 19, Vite 8, TypeScript 5.9, hls.js, Tailwind 3, lucide-react, clsx, tailwind-merge. `class-variance-authority` is present but not obviously used in the reviewed files; can remove if unused.
- **name:** Still `"frontend"`; consider `"hls-inspector"` for clarity now that the repo is app-root.

---

## 10. Summary table

| Area | Status | Notes |
|------|--------|--------|
| Structure & entry | ✅ | Clear; lib/store/App/components split. |
| Types | ✅ | Strong; InspectResult/store/inspect aligned. |
| HLS parsing & checks | ✅ | Master/media, variants, segments, SCTE-35, captions, health checks. |
| Player & segment playback | ✅ | Blob m3u8, cleanup, error message. |
| Security / CORS | ✅ | Documented; no injection from manifests. |
| Poll error handling | ⚠️ | Catch is empty; consider updating stream state on failure. |
| loadDetail reset | ⚠️ | Reset `selectedPlaylistVariantIndex` when opening a stream. |
| List keys | ⚠️ | Prefer stable keys for issues list. |
| A11y | ⚠️ | Add aria-labels and optional aria-live for errors. |
| App size / splitting | 💡 | Optional: extract views and constants. |
| Tests | 💡 | No tests; add for parser and health checks if scaling. |

---

## Recommended next steps (priority)

1. **High:** In `loadDetail`, add `setSelectedPlaylistVariantIndex(0)`.
2. **High:** In the poll loop, on catch, set that stream’s state to error (or push an event) so the UI reflects failures.
3. **Medium:** Replace issues list `key={i}` with a stable key.
4. **Medium:** Remove duplicate `mp4a` check in `codecLabels`.
5. **Low:** Add `aria-label` (and optional `aria-live`) where it helps; consider extracting view components and a small constants/helpers module as the codebase grows.

Overall the codebase is in good shape: correct HLS behavior, clear data flow, and consistent UI. The items above are incremental improvements rather than fundamental changes.
