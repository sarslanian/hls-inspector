import { useEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer, measureElement } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import type { Scte35Entry } from "@/lib/inspect"
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react"

/** Window long cue lists; below this we render a plain stack (no scroll container). */
const VIRTUAL_LIST_THRESHOLD = 48

function formatSec(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const s = n.toFixed(3)
  return s.replace(/\.?0+$/, "")
}

function payloadPreview(s: string, max = 72): { short: string; truncated: boolean } {
  if (s.length <= max) return { short: s, truncated: false }
  return { short: s.slice(0, max) + "…", truncated: true }
}

function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative inline-flex flex-col items-stretch">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => {
              setFailed(false)
              setDone(true)
              setTimeout(() => setDone(false), 2000)
            },
            () => {
              setFailed(true)
              setTimeout(() => setFailed(false), 2800)
            }
          )
        }}
      >
        {done ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {failed ? "Copy failed" : done ? "Copied" : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {failed ? "Copy to clipboard failed." : done ? "Copied to clipboard." : ""}
      </span>
    </div>
  )
}

function DecodeLink({ value }: { value: string }) {
  return (
    <a
      href={`https://scte35.videotooling.com?cue=${encodeURIComponent(value)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
    >
      <ExternalLink className="h-3 w-3" />
      Open in parser
    </a>
  )
}

function Scte35Card({
  displayIndex,
  entry,
}: {
  displayIndex: number
  entry: Scte35Entry
}) {
  const { type } = entry
  const hasPayload = Boolean(entry.scte35_value)
  const preview = entry.scte35_value ? payloadPreview(entry.scte35_value) : null

  return (
    <Card className="border-border/80 shadow-none">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">#{displayIndex}</span>
            <span className="inline-flex max-w-full shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tracking-tight">
              {type}
            </span>
            {(entry.source_variant_index != null || entry.source_playlist_uri) && (
              <span
                className="max-w-full truncate text-[10px] text-muted-foreground"
                title={
                  entry.source_playlist_uri
                    ? `Variant ${entry.source_variant_index ?? "?"} · ${entry.source_playlist_uri}`
                    : `Variant ${entry.source_variant_index ?? "?"}`
                }
              >
                {entry.source_playlist_uri ? (
                  <>
                    <span className="font-mono tabular-nums">v{entry.source_variant_index ?? "?"}</span>
                    <span className="mx-1 opacity-60">·</span>
                    <span className="break-all">{entry.source_playlist_uri}</span>
                  </>
                ) : (
                  <span className="font-mono tabular-nums">Variant {entry.source_variant_index}</span>
                )}
              </span>
            )}
            {type === "AD_DURATION" && entry.advertised_seconds != null && (
              <span className="text-xs text-muted-foreground">
                Compares playlist segment sum to CUE-OUT duration
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasPayload && entry.scte35_value && (
              <>
                <DecodeLink value={entry.scte35_value} />
                <CopyTextButton text={entry.scte35_value} label="Copy payload" />
              </>
            )}
          </div>
        </div>

        {type === "AD_DURATION" &&
          entry.advertised_seconds != null &&
          entry.actual_seconds != null &&
          entry.delta_seconds != null && (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Advertised</p>
                <p className="font-mono tabular-nums">{formatSec(entry.advertised_seconds)}s</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">From segments</p>
                <p className="font-mono tabular-nums">{formatSec(entry.actual_seconds)}s</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Delta</p>
                <p
                  className={`font-mono tabular-nums ${
                    Math.abs(entry.delta_seconds) > 0.5 ? "text-amber-600 dark:text-amber-400" : ""
                  }`}
                >
                  {entry.delta_seconds > 0 ? "+" : ""}
                  {formatSec(entry.delta_seconds)}s
                </p>
              </div>
            </div>
          )}

        {type === "CUE-OUT" && entry.duration_advertised != null && (
          <p className="text-sm text-muted-foreground">
            Advertised break duration: <span className="font-mono text-foreground">{formatSec(entry.duration_advertised)}s</span>
          </p>
        )}

        {type === "CUE-OUT-CONT" &&
          (entry.elapsed_seconds != null || entry.cont_duration_seconds != null) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {entry.elapsed_seconds != null && (
                <span>
                  <span className="text-muted-foreground">Elapsed </span>
                  <span className="font-mono tabular-nums text-foreground">{formatSec(entry.elapsed_seconds)}s</span>
                </span>
              )}
              {entry.cont_duration_seconds != null && (
                <span>
                  <span className="text-muted-foreground">Duration </span>
                  <span className="font-mono tabular-nums text-foreground">{formatSec(entry.cont_duration_seconds)}s</span>
                </span>
              )}
            </div>
          )}

        {preview && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">SCTE-35 payload</p>
            <p
              className="break-all rounded-md border border-border/50 bg-background/80 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/90"
              title={entry.scte35_value}
            >
              {preview.short}
              {preview.truncated && entry.scte35_value && (
                <span className="text-muted-foreground"> ({entry.scte35_value.length} chars)</span>
              )}
            </p>
          </div>
        )}

        {entry.raw && (
          <details className="group rounded-lg border border-border/50 bg-muted/20">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              Full manifest tag
            </summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-border/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {entry.raw}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function TypeFilterDropdown({
  types,
  selected,
  onChange,
}: {
  types: string[]
  selected: Set<string>
  /** Pass `null` to mean “all types” (matches parent default) */
  onChange: (next: Set<string> | null) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        document.getElementById("scte35-type-filter")?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const toggle = (t: string) => {
    const next = new Set(selected)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    onChange(next.size === types.length ? null : next)
  }

  const n = selected.size
  const total = types.length
  const label =
    n === 0 ? "No types selected" : n === total ? `All types (${total})` : `${n} of ${total} types`

  return (
    <div className="relative min-w-[min(100%,14rem)] flex-1 sm:max-w-sm" ref={rootRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        id="scte35-type-filter"
        className="h-9 w-full justify-between gap-2 font-normal"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="scte35-type-filter-list"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate text-left text-xs sm:text-sm">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div
          id="scte35-type-filter-list"
          role="group"
          aria-labelledby="scte35-type-filter"
          aria-describedby="scte35-type-filter-hint"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
        >
          <p id="scte35-type-filter-hint" className="sr-only">
            Use checkboxes to include or exclude cue tag types. Press Escape to close.
          </p>
          {types.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border"
                checked={selected.has(t)}
                onChange={() => toggle(t)}
              />
              <span className="font-mono text-xs">{t}</span>
            </label>
          ))}
          <div className="flex gap-2 border-t border-border px-2 py-2">
            <Button type="button" variant="secondary" size="sm" className="h-7 flex-1 text-xs" onClick={() => onChange(null)}>
              All
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={() => onChange(new Set())}>
              None
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Isolated so React Compiler does not treat TanStack Virtual as incompatible with the parent panel. */
function VirtualizedScteCueList({ filtered }: { filtered: Scte35Entry[] }) {
  const scrollParentRef = useRef<HTMLDivElement>(null)
  /* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally returns non-memoizable refs */
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 200,
    measureElement,
    overscan: 8,
    getItemKey: (index) => {
      const e = filtered[index]
      return `${e.source_variant_index ?? 0}-${e.type}-${index}-${e.raw?.slice(0, 80) ?? ""}`
    },
  })
  /* eslint-enable react-hooks/incompatible-library */

  return (
    <div
      ref={scrollParentRef}
      className="max-h-[min(70vh,560px)] overflow-auto rounded-lg border border-border/60 bg-muted/20 p-1"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const entry = filtered[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 right-0 top-0 px-1 pb-3"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <Scte35Card displayIndex={vi.index + 1} entry={entry} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Scte35CuePanelBody({
  reverseChrono,
  uniqueTypes,
}: {
  reverseChrono: Scte35Entry[]
  uniqueTypes: string[]
}) {
  /** `null` = all types (default); explicit Set when user changes filter */
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null)

  const activeTypes = useMemo(() => typeFilter ?? new Set(uniqueTypes), [typeFilter, uniqueTypes])

  const filtered = useMemo(
    () => reverseChrono.filter((e) => activeTypes.has(e.type)),
    [reverseChrono, activeTypes]
  )

  const useVirtualList = filtered.length >= VIRTUAL_LIST_THRESHOLD

  return (
    <>
      {uniqueTypes.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Label htmlFor="scte35-type-filter" className="shrink-0 text-xs font-medium text-muted-foreground sm:pt-1.5">
            Tag types
          </Label>
          <TypeFilterDropdown
            types={uniqueTypes}
            selected={activeTypes}
            onChange={setTypeFilter}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No cues match the selected types. Choose one or more types in the filter above.
        </p>
      ) : useVirtualList ? (
        <VirtualizedScteCueList filtered={filtered} />
      ) : (
        <div className="space-y-3">
          {filtered.map((entry, i) => (
            <Scte35Card
              key={`${entry.source_variant_index ?? 0}-${entry.type}-${i}-${entry.raw?.slice(0, 24) ?? ""}`}
              displayIndex={i + 1}
              entry={entry}
            />
          ))}
        </div>
      )}
    </>
  )
}

export function Scte35CuePanel({ entries }: { entries: Scte35Entry[] }) {
  /** Last line in playlist ≈ most recent; show newest first */
  const reverseChrono = useMemo(() => [...entries].reverse(), [entries])

  const uniqueTypes = useMemo(() => [...new Set(entries.map((e) => e.type))].sort((a, b) => a.localeCompare(b)), [entries])

  const typesKey = uniqueTypes.join("\0")

  const summary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, n]) => `${n}× ${t}`)
      .join(" · ")
  }, [entries])

  if (!entries.length) return null

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Tags and payloads collected from the inspected media playlist (CUE-OUT, continuation, CUE-IN, DATERANGE, etc.).
        </p>
        <p className="text-xs text-muted-foreground/90">{summary}</p>
        <p className="text-xs text-muted-foreground/80">Newest tags first (reverse playlist order).</p>
      </div>

      <Scte35CuePanelBody key={typesKey} reverseChrono={reverseChrono} uniqueTypes={uniqueTypes} />
    </div>
  )
}
