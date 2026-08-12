"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface CreatorOption {
  handle: string;
  display_name?: string | null;
}

// Reusable creator search with autocomplete over the indexed creators. Used on
// the allocations page (pick a creator to override) and the terminal (jump to /
// filter by a creator). Purely presentational — the parent supplies the list
// and handles selection.
export function CreatorSearch({
  creators,
  onSelect,
  placeholder = "search creators…",
  autoFocus,
}: {
  creators: CreatorOption[];
  onSelect: (handle: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^@/, "");
    const pool = creators ?? [];
    if (!t) return pool.slice(0, 8);
    return pool
      .filter((c) => c.handle.toLowerCase().includes(t) || (c.display_name?.toLowerCase().includes(t) ?? false))
      .slice(0, 8);
  }, [q, creators]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(handle: string) {
    onSelect(handle);
    setQ("");
    setOpen(false);
    setActive(0);
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          border: `1.5px solid ${open ? "var(--ink)" : "var(--line)"}`,
          borderRadius: 999,
          background: "var(--surface)",
          padding: "13px 18px",
          transition: "border-color 0.18s, box-shadow 0.18s",
          boxShadow: open ? "0 0 0 4px color-mix(in oklch, var(--ink) 6%, transparent)" : "none",
        }}
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: open ? "var(--ink)" : "var(--faint)" }}>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <line x1="21" y1="21" x2="16.4" y2="16.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const m = matches[active];
              if (m) pick(m.handle);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label="Search creators"
          style={{
            flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0,
            color: "var(--ink)", fontFamily: "var(--font-display)", fontSize: 16,
          }}
        />
        {q && (
          <button
            aria-label="clear"
            onClick={() => { setQ(""); setOpen(false); }}
            style={{
              display: "grid", placeItems: "center", width: 22, height: 22, flexShrink: 0,
              background: "var(--faint)", color: "var(--bg)", border: 0, borderRadius: "50%",
              cursor: "pointer", fontSize: 12, lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, zIndex: 40,
            background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 18,
            overflow: "hidden", boxShadow: "0 16px 40px color-mix(in oklch, var(--ink) 14%, transparent)",
          }}
        >
          <div className="label" style={{ padding: "10px 16px 2px", color: "var(--faint)" }}>creators</div>
          {matches.map((c, i) => (
            <button
              key={c.handle}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(c.handle); }}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                padding: "10px 16px", border: 0, cursor: "pointer",
                background: i === active ? "color-mix(in oklch, var(--ink) 6%, transparent)" : "transparent",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://unavatar.io/twitter/${c.handle}`} alt="" width={36} height={36} style={{ borderRadius: "50%", flexShrink: 0, border: "1px solid var(--line)" }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.display_name || c.handle}
                </span>
                <span className="label" style={{ color: "var(--muted)" }}>@{c.handle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
