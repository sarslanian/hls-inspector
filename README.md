# HLS Inspector

A **frontend-only** stream monitor for 24/7 FAST (Free Ad-Supported Streaming TV) channels delivered via HLS. Inspect manifests, segment health, discontinuities, and SCTE-35 ad cues — **no server**. Everything runs in the browser.

## Features

- **Stream list**: Add master or media playlist URLs; see status (healthy / warning / error) and last check time.
- **Stream detail**: Side-by-side view — video preview (left) and inspection tabs (right). Variant selector to cycle through renditions; segment list per variant; SCTE-35 cues; raw playlist.
- **Health checks**: Staleness (live), discontinuity detection, segment continuity, cross-rendition alignment.
- **SCTE-35**: Parse and display `#EXT-X-CUE-OUT`, `#EXT-X-CUE-IN`, `#EXT-X-DATERANGE`, etc.; ad break advertised vs actual duration.
- **Recent issues**: In-memory log (last 200). Stream list saved in **localStorage**.
- **Background polling**: Streams re-inspected every 10 seconds in the browser.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build & deploy

```bash
npm run build
```

Output is in `dist/`. Serve locally with `npx serve dist`.

### Deploy on Vercel

Connect the repo to Vercel. The project root is the app; Vercel will detect Vite and use `npm run build` and output `dist`. No config needed.

Or deploy `dist/` to **GitHub Pages**, **Netlify**, etc.

## CORS

The app fetches HLS manifests from the URLs you add. Cross-origin URLs follow the browser’s CORS policy; many CDNs allow it. If you see CORS errors, that origin is blocking browser requests.

## Tech

- **React** + **Vite** + **TypeScript**
- **Tailwind** + **shadcn/ui**-style components
- **hls.js** for video playback
- Client-side M3U8 parsing, health checks, and SCTE-35 extraction

## License

MIT.
