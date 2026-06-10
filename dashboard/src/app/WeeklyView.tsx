"use client";

import type React from "react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { TrainingProductSummary, WeeklyReport } from "@/lib/weekly";
import TrainingProductDrawer from "@/components/TrainingProductDrawer";
import CMEngagementsDrawer from "@/components/CMEngagementsDrawer";
import StorePhotosDrawer from "@/components/StorePhotosDrawer";

const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

const wkSanitize = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"] };

// Link interceptor for AI narrative chips:
//   /visits/store/<store_id>                     → store drawer
//   /visits/visit/<store_id>/<visit_id>?hl=<v>   → visit drawer (hl = source section)
function narrativeComponents(onOpenStore: (id: string) => void, onOpenVisit: (id: string, hl?: string | null) => void) {
  return {
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      const visitMatch = href?.match(/^\/visits\/visit\/([^/?#]+)\/([^/?#]+)/);
      if (visitMatch) {
        const visitId = visitMatch[2];
        const hl = href?.match(/[?&]hl=([^&#]+)/)?.[1] ?? null;
        return <button className="wk-chip" onClick={() => onOpenVisit(visitId, hl)}>{children}</button>;
      }
      const storeMatch = href?.match(/^\/visits\/store\/([^/?#]+)/);
      if (storeMatch) {
        return <button className="wk-chip" onClick={() => onOpenStore(storeMatch[1])}>{children}</button>;
      }
      return <a href={href}>{children}</a>;
    },
  };
}

// Hardcoded subtitle notes for old-format narrative sections that lack a kicker line.
// New-format reports emit an italic kicker under each "## " heading — we use that.
// Old-format: no kicker → fall back to these.
const NARRATIVE_FALLBACK_NOTE: Record<string, string> = {
  goodnews:    "concrete wins only",
  signals:     "noteworthy patterns & one-off observations",
  alerts:      "risks & issues needing attention",
  engagements: "notable people interactions and training moments",
};

// Split the stored AI narrative (one markdown blob with `## Good News`, `## Signals`,
// `## Alerts`, `## Engagements`) into one chunk per heading so each renders in its own
// card. Returns { heading, note, body } — note is the italic kicker line if present,
// else a fallback. Any leading emoji/symbols in the stored heading are stripped — the
// card injects exactly one emoji itself (works for both legacy and new reports).
function splitNarrative(md: string): { heading: string; note: string; body: string }[] {
  const chunks = md.split(/\n(?=## )/);
  const result: { heading: string; note: string; body: string }[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith("##")) continue;
    const firstNl = trimmed.indexOf("\n");
    if (firstNl === -1) continue;
    const heading = trimmed.slice(0, firstNl).replace(/^##\s*/, "").replace(/^[^A-Za-z0-9]+/, "").trim();
    const rest = trimmed.slice(firstNl + 1).trim();
    // Check if the first line of body is a kicker (italic: starts with * or _)
    const restLines = rest.split("\n");
    let note = "";
    let body = rest;
    if (restLines[0] && /^\*[^*]|^_[^_]/.test(restLines[0].trim())) {
      note = restLines[0].trim().replace(/^\*|\*$|^_|_$/g, "").trim();
      body = restLines.slice(1).join("\n").trim();
    } else {
      const slug = heading.toLowerCase().replace(/\s+/g, "");
      note = NARRATIVE_FALLBACK_NOTE[slug] ?? "";
    }
    if (body.length > 0) result.push({ heading, note, body });
  }
  return result;
}

function fmtWow(n: number | null): string | null {
  if (n === null) return null;
  return n >= 0 ? `▲ +${n}% visits vs last wk` : `▼ ${Math.abs(n)}% visits vs last wk`;
}

type StoreGroupBy = "Market" | "Chain" | "Tier";

type ExecView = "CMs" | "Products" | "Stores";
type HeatOuter = "Country" | "Tier";
const EXEC_VIEW_LABEL: Record<ExecView, string> = {
  CMs: "Channel Managers",
  Products: "Products",
  Stores: "Stores",
};

// Amber heat scale for the Stores view: 0 → neutral, 4+ → deepest.
const HEAT_SCALE = ["#f1eee7", "#fdedcb", "#fbd9a0", "#f7bd66", "#ef9d1f"];
const heatColor = (n: number) => HEAT_SCALE[Math.min(n, HEAT_SCALE.length - 1)];

// Heatmap group order: SG first, unknown markets last.
const MARKET_ORDER = ["SG", "MY", "TH", "HK"];
const marketRank = (m: string) => {
  const i = MARKET_ORDER.indexOf(m);
  return i === -1 ? MARKET_ORDER.length : i;
};

// Store names carry "Chain @ Location" — under a chain group header the prefix
// is redundant, so show just the location.
const stripChain = (name: string, chain: string) =>
  chain && name.toLowerCase().startsWith(chain.toLowerCase() + " @ ")
    ? name.slice(chain.length + 3)
    : name;

export function WeeklyView({
  report,
  onOpenStore,
  onOpenVisit,
}: {
  report: WeeklyReport;
  onOpenStore: (storeId: string) => void;
  onOpenVisit?: (visitId: string, hl?: string | null) => void;
}) {
  const { stats, trainingProducts, byDay, storeDayMatrix, perCM, storesVisited } = report;

  // Drawer + grouping state
  const [trainingProduct, setTrainingProduct] = useState<TrainingProductSummary | null>(null);
  const [cmDrawer, setCmDrawer] = useState<WeeklyReport["perCM"][number] | null>(null);
  const [photoStore, setPhotoStore] = useState<{ id: string; name: string } | null>(null);
  const [storeGroupBy, setStoreGroupBy] = useState<StoreGroupBy>("Market");
  const [execView, setExecView] = useState<ExecView>("CMs");
  const [heatOuter, setHeatOuter] = useState<HeatOuter>("Country");
  const [collapsedChains, setCollapsedChains] = useState<Set<string>>(new Set());

  const toggleChain = (k: string) =>
    setCollapsedChains((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Store cards grouped by the selected dimension, small headers per group.
  const storeGroups = useMemo(() => {
    const keyOf = (s: WeeklyReport["storesVisited"][number]) =>
      storeGroupBy === "Market" ? s.market : storeGroupBy === "Chain" ? s.chain : (s.tier ?? "Untiered");
    const map = new Map<string, WeeklyReport["storesVisited"][number][]>();
    for (const s of storesVisited) {
      const k = keyOf(s) || "—";
      const list = map.get(k) ?? [];
      list.push(s);
      map.set(k, list);
    }
    return Array.from(map.keys()).sort().map((key) => ({
      key,
      stores: map.get(key)!, // already sorted by store name from the payload
    }));
  }, [storesVisited, storeGroupBy]);

  // Stores heatmap: outer groups by Country or Tier (selectable), channel groups
  // within (always), stores alphabetical. Each level carries per-day totals so
  // group headers double as aggregate heat rows.
  const heatGroups = useMemo(() => {
    const sumDays = (rows: WeeklyReport["storeDayMatrix"]) => {
      const t = [0, 0, 0, 0, 0, 0, 0];
      for (const r of rows) r.counts.forEach((n, i) => { t[i] += n; });
      return t;
    };
    const outer = new Map<string, Map<string, WeeklyReport["storeDayMatrix"]>>();
    for (const s of storeDayMatrix) {
      const ok = heatOuter === "Country" ? (s.market || "—") : (s.tier ?? "Untiered");
      const chain = s.chain || "—";
      const chains = outer.get(ok) ?? new Map<string, WeeklyReport["storeDayMatrix"]>();
      const rows = chains.get(chain) ?? [];
      rows.push(s);
      chains.set(chain, rows);
      outer.set(ok, chains);
    }
    return Array.from(outer.entries())
      .map(([key, chains]) => {
        const chainGroups = Array.from(chains.entries())
          .map(([chain, rows]) => ({
            chain,
            rows: rows.sort((a, b) => a.store.localeCompare(b.store)),
            dayTotals: sumDays(rows),
          }))
          .sort((a, b) => a.chain.localeCompare(b.chain));
        const allRows = chainGroups.flatMap((c) => c.rows);
        return {
          key,
          chainGroups,
          dayTotals: sumDays(allRows),
          stores: allRows.length,
          visits: allRows.reduce((t, r) => t + r.total, 0),
        };
      })
      .sort((a, b) =>
        heatOuter === "Country"
          ? marketRank(a.key) - marketRank(b.key) || a.key.localeCompare(b.key)
          : a.key.localeCompare(b.key),
      );
  }, [storeDayMatrix, heatOuter]);

  const narrativeSections = report.narrativeMarkdown ? splitNarrative(report.narrativeMarkdown) : [];

  const maxDayCount = Math.max(...byDay.map((d) => d.count), 1);
  const peakDay = byDay.reduce((best, d) => (d.count > best.count ? d : best), byDay[0]);

  const wow = fmtWow(stats.wowPct);

  // Determine if stores-reach is low (< 40%)
  const reachPct = stats.totalStores > 0 ? Math.round((stats.storesCovered / stats.totalStores) * 100) : 0;
  const reachWarn = reachPct < 40;

  return (
    <div className="wk">
      <style>{WK_CSS}</style>

      {/* Header */}
      <div className="wk-rpt-head">
        <div>
          <h1 className="wk-h1">📊 Store Visit — Weekly Report</h1>
          <p className="wk-rpt-sub">
            {report.label}
            {perCM.length > 0
              ? " · " + [...new Set(perCM.map((c) => c.market))].join(" + ")
              : ""}
          </p>
        </div>
        {wow && <span className="wk-wow">{wow}</span>}
      </div>

      {/* Stat Tiles */}
      <div className="wk-tiles">
        <div className="wk-tile">
          <div className="wk-tile-n">
            {stats.executed}
            <span className="wk-tile-of"> / {stats.planned}</span>
          </div>
          <div className="wk-tile-l">Executed / Planned</div>
          {stats.planned === 0 && (
            <div className="wk-tile-d warn">no plans logged</div>
          )}
        </div>
        <div className="wk-tile">
          <div className="wk-tile-n">{stats.engagements}</div>
          <div className="wk-tile-l">Engagements</div>
          <div className="wk-tile-d">{stats.productTrainings} product trainings</div>
        </div>
        <div className="wk-tile">
          <div className="wk-tile-n">
            {stats.activeCMs}
            <span className="wk-tile-of"> / {stats.totalCMs}</span>
          </div>
          <div className="wk-tile-l">CMs active</div>
          <div className="wk-tile-d">
            {[...new Set(perCM.map((c) => c.market))].length} market
            {[...new Set(perCM.map((c) => c.market))].length !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="wk-tile">
          <div className="wk-tile-n">
            {stats.storesCovered}
            <span className="wk-tile-of"> / {stats.totalStores}</span>
          </div>
          <div className="wk-tile-l">Stores covered</div>
          <div className={`wk-tile-d${reachWarn ? " warn" : ""}`}>
            {reachPct}% reach
          </div>
        </div>
      </div>

      {/* Visits By Day */}
      <div className="wk-cadence">
        <div className="wk-cadence-top">
          <h4 className="wk-cadence-h">Visits By Day</h4>
          {peakDay.count > 0 && (
            <span className="wk-peak">{peakDay.dow} peak · {peakDay.count} visits</span>
          )}
        </div>
        <div className="wk-bars">
          {byDay.map((d) => {
            const heightPct = maxDayCount > 0 ? Math.round((d.count / maxDayCount) * 100) : 0;
            const isPeak = d.count === maxDayCount && d.count > 0;
            const isOff = d.count === 0;
            return (
              <div key={d.dow} className="wk-bar-col">
                <span className="wk-bar-n">{d.count}</span>
                <div
                  className={`wk-bar${isPeak ? " peak" : ""}${isOff ? " off" : ""}`}
                  style={{ height: isOff ? "100%" : `${Math.max(heightPct, 4)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="wk-bar-row">
          {byDay.map((d) => (
            <div key={d.dow} className="wk-bar-col">
              <span className="wk-bar-d">{d.dow}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Execution Summary — one section, three switchable views */}
      <section className="wk-section">
        <h2 className="wk-sh2">🎯 Execution Summary</h2>
        {stats.planned === 0 && (
          <p className="wk-sec-note">
            {perCM.map((c) => `${c.market} ${c.visited}`).join(" · ")}
            {perCM.length > 0 ? " · " : ""}no visit plans logged this week.
          </p>
        )}
        <div className="wk-grp-row">
          {(["CMs", "Products", "Stores"] as ExecView[]).map((v) => (
            <button
              key={v}
              className={`wk-grp-chip${execView === v ? " on" : ""}`}
              onClick={() => setExecView(v)}
            >
              {EXEC_VIEW_LABEL[v]}
            </button>
          ))}
        </div>

        {execView === "CMs" && (
          <>
            <table className="wk-table">
              <thead>
                <tr>
                  <th className="wk-th l">Channel Manager</th>
                  <th className="wk-th c">Market</th>
                  <th className="wk-th c">Visited</th>
                  <th className="wk-th c">Engagements</th>
                </tr>
              </thead>
              <tbody>
                {perCM.map((cm, i) => (
                  <tr key={i}>
                    <td className="wk-td l">{cm.cm}</td>
                    <td className="wk-td c">
                      <span className="wk-mk">{MARKET_FLAG[cm.market] ?? ""} {cm.market}</span>
                    </td>
                    <td className="wk-td c wk-num">{cm.visited}</td>
                    <td className="wk-td c wk-num">
                      {cm.engagements > 0 ? (
                        <button className="wk-cell-btn" onClick={() => setCmDrawer(cm)}>
                          {cm.engagements}<span className="wk-cell-chev">›</span>
                        </button>
                      ) : (
                        cm.engagements
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="wk-tr-total">
                  <td className="wk-td l">All CMs</td>
                  <td className="wk-td c">—</td>
                  <td className="wk-td c wk-num">{stats.executed}</td>
                  <td className="wk-td c wk-num">{stats.engagements}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {execView === "Products" && (
          <>
            {trainingProducts.length > 0 ? (
              <table className="wk-table wk-train-table">
                <thead>
                  <tr>
                    <th className="wk-th l">Product</th>
                    <th className="wk-th c">Trainings</th>
                    <th className="wk-th c">People</th>
                    <th className="wk-th c" />
                  </tr>
                </thead>
                <tbody>
                  {trainingProducts.map((tp) => (
                    <tr key={tp.product}>
                      <td className="wk-td l">{tp.product}</td>
                      <td className="wk-td c wk-num">{tp.trainings}</td>
                      <td className="wk-td c wk-num">{tp.people}</td>
                      <td className="wk-td c">
                        <button className="wk-view-btn" onClick={() => setTrainingProduct(tp)}>view →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="wk-sec-note">No product trainings logged this week.</p>
            )}
          </>
        )}

        {execView === "Stores" && (
          storeDayMatrix.length > 0 ? (
            <div className="wk-hm">
              <div className="wk-grp-row">
                {(["Country", "Tier"] as HeatOuter[]).map((g) => (
                  <button
                    key={g}
                    className={`wk-grp-chip${heatOuter === g ? " on" : ""}`}
                    onClick={() => setHeatOuter(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="wk-hm-row wk-hm-head">
                <span />
                {byDay.map((d) => (
                  <span key={d.dow} className="wk-hm-day">{d.dow}</span>
                ))}
              </div>
              {heatGroups.map((grp) => (
                <div key={grp.key}>
                  {/* Outer header — group-level stats + aggregate heat row */}
                  <div className="wk-hm-row wk-hm-outer">
                    <span className="wk-hm-outer-label" title={grp.key}>
                      {heatOuter === "Country" ? `${MARKET_FLAG[grp.key] ?? ""} ${grp.key}` : grp.key}
                      <span className="wk-hm-outer-stats">
                        {grp.stores} store{grp.stores !== 1 ? "s" : ""} · {grp.visits} visit{grp.visits !== 1 ? "s" : ""}
                      </span>
                    </span>
                    {grp.dayTotals.map((n, i) => (
                      <span
                        key={i}
                        className="wk-hm-cell"
                        style={{ background: heatColor(n) }}
                        title={`${grp.key} — ${byDay[i]?.dow}: ${n} visit${n === 1 ? "" : "s"}`}
                      />
                    ))}
                  </div>
                  {grp.chainGroups.map((cg) => {
                    const ck = `${grp.key}|${cg.chain}`;
                    const collapsed = collapsedChains.has(ck);
                    return (
                      <div key={ck}>
                        {/* Chain header — collapsible; shows its aggregate heat row when collapsed */}
                        <div className="wk-hm-row">
                          <button className="wk-hm-chain" onClick={() => toggleChain(ck)} title={cg.chain}>
                            <span className="chev">{collapsed ? "▸" : "▾"}</span>
                            {cg.chain}
                            <span className="ct">{cg.rows.length}</span>
                          </button>
                          {collapsed && cg.dayTotals.map((n, i) => (
                            <span
                              key={i}
                              className="wk-hm-cell"
                              style={{ background: heatColor(n) }}
                              title={`${cg.chain} — ${byDay[i]?.dow}: ${n} visit${n === 1 ? "" : "s"}`}
                            />
                          ))}
                        </div>
                        {!collapsed && cg.rows.map((s) => (
                          <div key={s.storeId} className="wk-hm-row">
                            <button className="wk-hm-store ind" onClick={() => onOpenStore(s.storeId)} title={s.store}>
                              {stripChain(s.store, s.chain)}
                            </button>
                            {s.counts.map((n, i) => (
                              <span
                                key={i}
                                className="wk-hm-cell"
                                style={{ background: heatColor(n) }}
                                title={`${s.store} — ${byDay[i]?.dow}: ${n} visit${n === 1 ? "" : "s"}`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="wk-hm-legend">
                <span>0</span>
                {HEAT_SCALE.map((c) => (
                  <span key={c} className="wk-hm-swatch" style={{ background: c }} />
                ))}
                <span>4+ visits</span>
              </div>
            </div>
          ) : (
            <p className="wk-sec-note">No stores visited this week.</p>
          )
        )}
      </section>

      {/* AI narrative — one card per section (stored, editable). */}
      {narrativeSections.length > 0 ? (
        narrativeSections.map((sec, i) => {
          const slug = sec.heading.toLowerCase().replace(/\s+/g, "");
          const isAlert = slug.includes("alert");
          const emoji = isAlert ? "🚨" : slug.includes("signal") ? "🔔" : slug.includes("good") ? "🌟" : "🤝";
          return (
            <section key={i} className={`wk-section wk-narrative${isAlert ? " wk-narrative-alert" : ""}`}>
              <h2 className="wk-sh2">
                {emoji} {sec.heading}
                {sec.note && <span className="wk-sub">— {sec.note}</span>}
              </h2>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, wkSanitize]]}
                components={narrativeComponents(onOpenStore, onOpenVisit ?? (() => undefined))}
              >
                {sec.body}
              </ReactMarkdown>
            </section>
          );
        })
      ) : (
        <div className="wk-ai-placeholder">
          🌟 Good News · 🔔 Signals · 🚨 Alerts · 🤝 Engagements — AI narrative generates weekly (coming soon)
        </div>
      )}

      {/* Store Updates — every store visited this week, grouped by the selected
          dimension. Click a card → photo-history drawer. */}
      <section className="wk-section">
        <h2 className="wk-sh2">🏪 Store Updates</h2>
        <p className="wk-sec-note">Every store visited this week — tap a card for its photo history.</p>
        <div className="wk-grp-row">
          {(["Market", "Chain", "Tier"] as StoreGroupBy[]).map((g) => (
            <button
              key={g}
              className={`wk-grp-chip${storeGroupBy === g ? " on" : ""}`}
              onClick={() => setStoreGroupBy(g)}
            >
              {g}
            </button>
          ))}
        </div>
        {storeGroups.map((grp) => (
          <div key={grp.key}>
            <div className="wk-grp-hd">
              <span>{storeGroupBy === "Market" ? `${MARKET_FLAG[grp.key] ?? ""} ${grp.key}` : grp.key}</span>
              <span className="ct">{grp.stores.length}</span>
            </div>
            {grp.stores.map((s) => (
              <button
                key={s.storeId}
                className="wk-store-card"
                onClick={() => setPhotoStore({ id: s.storeId, name: s.store })}
              >
                <span className="wk-store-main">
                  <span className="wk-store-name">{s.store}</span>
                  <span className="wk-store-meta">{s.chain} · {s.market} · {s.tier ?? "—"}</span>
                </span>
                <span className="wk-store-cam">📷 {s.photos} ›</span>
              </button>
            ))}
          </div>
        ))}
        {storesVisited.length === 0 && (
          <p className="wk-sec-note">No stores visited this week.</p>
        )}
      </section>

      {/* Drawers */}
      <TrainingProductDrawer product={trainingProduct} onClose={() => setTrainingProduct(null)} />
      <CMEngagementsDrawer cm={cmDrawer} onClose={() => setCmDrawer(null)} />
      <StorePhotosDrawer store={photoStore} onClose={() => setPhotoStore(null)} />
    </div>
  );
}

// ─── CSS — all scoped under .wk ───────────────────────────────────────────────
const WK_CSS = `
.wk{--wk-bg:#f6f4ef;--wk-card:#fff;--wk-ink:#1b1a18;--wk-muted:#6c6862;--wk-faint:#9a958c;
  --wk-line:#e8e4db;--wk-accent:#0f6e5c;--wk-accent2:#12856f;--wk-accent-soft:#e4f1ec;
  --wk-alert:#a3322a;--wk-alert-soft:#f8e7e4;--wk-warn:#b4621f;--wk-warn-soft:#fbeedf;
  --wk-chip:#eef1f4;--wk-chip-ink:#2f4f6b;
  padding-top:4px;color:var(--wk-ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;}

/* header */
.wk-rpt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:18px;}
.wk-h1{font-size:21px;margin:0;letter-spacing:-.3px;}
.wk-rpt-sub{color:var(--wk-muted);font-size:13px;margin:3px 0 0;}
.wk-wow{font-size:12px;font-weight:600;color:var(--wk-accent);background:var(--wk-accent-soft);
  padding:4px 9px;border-radius:20px;white-space:nowrap;flex-shrink:0;}

/* stat tiles */
.wk-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 10px;}
.wk-tile{background:var(--wk-card);border:1px solid var(--wk-line);border-radius:12px;padding:13px 10px;text-align:center;}
.wk-tile-n{font-size:23px;font-weight:700;letter-spacing:-.5px;}
.wk-tile-of{color:var(--wk-faint);font-weight:600;font-size:17px;}
.wk-tile-l{font-size:10.5px;color:var(--wk-muted);margin-top:3px;text-transform:uppercase;letter-spacing:.4px;}
.wk-tile-d{font-size:11px;font-weight:600;margin-top:2px;color:var(--wk-accent);}
.wk-tile-d.warn{color:var(--wk-warn);}

/* cadence chart */
.wk-cadence{background:var(--wk-card);border:1px solid var(--wk-line);border-radius:12px;
  padding:15px 18px 12px;margin:10px 0;}
.wk-cadence-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;}
.wk-cadence-h{margin:0;font-size:11px;color:var(--wk-muted);text-transform:uppercase;
  letter-spacing:.5px;font-weight:600;}
.wk-peak{font-size:11px;color:var(--wk-accent);font-weight:600;}
.wk-bars{display:flex;align-items:flex-end;gap:8px;height:104px;
  border-bottom:2px solid var(--wk-line);padding-bottom:0;}
.wk-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%;}
.wk-bar-n{font-size:12px;font-weight:700;color:var(--wk-ink);}
.wk-bar{width:100%;max-width:46px;border-radius:6px 6px 0 0;
  background:linear-gradient(180deg,var(--wk-accent2),var(--wk-accent));min-height:3px;}
.wk-bar.peak{background:linear-gradient(180deg,#1aa085,#0f6e5c);box-shadow:0 0 0 2px var(--wk-accent-soft);}
.wk-bar.off{background:repeating-linear-gradient(45deg,#efece5,#efece5 4px,#f6f4ef 4px,#f6f4ef 8px);}
.wk-bar-row{display:flex;gap:8px;margin-top:5px;}
.wk-bar-row .wk-bar-col{gap:0;}
.wk-bar-d{font-size:10.5px;color:var(--wk-muted);margin-top:7px;}

/* sections */
.wk-section{background:var(--wk-card);border:1px solid var(--wk-line);border-radius:14px;
  padding:17px 19px;margin:14px 0;}
/* Unified heading — matches daily's intel h2 kicker style */
.wk-sh2{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--wk-muted);
  font-weight:700;margin:0 0 12px;display:flex;align-items:center;gap:7px;}
.wk-sub{font-size:11px;font-weight:400;color:var(--wk-muted);text-transform:none;letter-spacing:0;}
.wk-sec-note{font-size:12.5px;color:var(--wk-muted);margin:4px 0 14px;}

/* execution table */
.wk-table{width:100%;border-collapse:collapse;font-size:14px;}
.wk-th{color:var(--wk-muted);font-weight:600;font-size:10.5px;text-transform:uppercase;
  letter-spacing:.3px;padding:7px 8px;border-bottom:1px solid var(--wk-line);}
.wk-th.l,.wk-td.l{text-align:left;}
.wk-th.c,.wk-td.c{text-align:center;}
.wk-td{padding:9px 8px;border-bottom:1px solid var(--wk-line);}
.wk-table tbody tr:last-child .wk-td{border-bottom:none;}
.wk-tr-total .wk-td{font-weight:700;border-top:2px solid var(--wk-line);}
.wk-num{font-variant-numeric:tabular-nums;}
.wk-mk{font-size:11px;font-weight:700;color:var(--wk-chip-ink);background:var(--wk-chip);
  padding:2px 8px;border-radius:5px;display:inline-block;}
/* clickable engagements cell */
.wk-cell-btn{font:inherit;font-variant-numeric:tabular-nums;background:none;border:none;
  color:var(--wk-ink);cursor:pointer;padding:0;display:inline-flex;align-items:baseline;gap:3px;}
.wk-cell-btn:hover{color:var(--wk-accent);}
.wk-cell-chev{color:var(--wk-faint);font-size:12px;}

/* narrative (Good News / Signals / Alerts / Engagements) */
.wk-narrative-alert{background:#fdf6f3;border-color:#e8cfc9;}
.wk-narrative-alert .wk-sh2{color:var(--wk-alert);}
/* Nested-bullet scannability: bold headline, indented sub-bullets muted + smaller */
.wk-narrative ul{margin:0;padding:0;list-style:none;}
.wk-narrative li{padding:9px 0;border-top:1px solid var(--wk-line);line-height:1.5;font-size:14px;}
.wk-narrative li:first-child{border-top:none;padding-top:2px;}
.wk-narrative li>strong:first-child{font-weight:700;color:var(--wk-ink);display:block;margin-bottom:2px;}
/* Sub-bullets: ul inside li */
.wk-narrative li ul{padding-left:16px;margin-top:4px;list-style:disc;}
.wk-narrative li ul li{padding:2px 0;border-top:none;font-size:12.5px;color:var(--wk-muted);list-style:disc;}
/* "Sources:" sub-bullet renders chips inline */
.wk-narrative li ul li:last-child:has(.wk-chip){border-top:none;padding-top:4px;}
.wk-narrative p{font-size:14px;margin:6px 0;}
.wk-narrative strong{font-weight:700;}
.wk-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--wk-chip-ink);
  background:var(--wk-chip);border:1px solid transparent;padding:1px 9px;border-radius:20px;
  cursor:pointer;margin:0 2px;transition:.15s;line-height:1.4;vertical-align:baseline;}
.wk-chip:hover{background:#e1e6ec;border-color:#cdd6df;}
.wk-chip::before{content:"↗";font-size:10px;opacity:.5;}

/* trainings-by-product table */
.wk-train-table{margin-top:12px;}
.wk-view-btn{font-size:11.5px;font-weight:600;color:var(--wk-chip-ink);background:var(--wk-chip);
  border:none;border-radius:20px;padding:2px 10px;cursor:pointer;font-family:inherit;transition:.15s;}
.wk-view-btn:hover{background:#e1e6ec;}

/* store updates — group chips + flat store cards */
.wk-grp-row{display:flex;gap:6px;margin:2px 0 4px;}
.wk-grp-chip{font-size:11.5px;font-weight:600;border:1px solid var(--wk-line);background:#fff;
  color:var(--wk-muted);border-radius:20px;padding:4px 12px;cursor:pointer;font-family:inherit;transition:.15s;}
.wk-grp-chip.on{background:var(--wk-accent-soft);color:var(--wk-accent);border-color:transparent;font-weight:700;}
.wk-grp-hd{font-size:10.5px;font-weight:700;color:var(--wk-chip-ink);text-transform:uppercase;
  letter-spacing:.4px;margin:14px 2px 4px;display:flex;justify-content:space-between;align-items:baseline;}
.wk-grp-hd .ct{color:var(--wk-faint);font-weight:600;}
.wk-store-card{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;
  text-align:left;background:#fff;border:1px solid var(--wk-line);border-radius:10px;
  padding:10px 14px;margin:6px 0;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s;}
.wk-store-card:hover{background:#f4f1ea;border-color:#d8d3c8;}
.wk-store-main{min-width:0;}
.wk-store-name{font-size:13.5px;font-weight:600;color:var(--wk-ink);display:block;}
.wk-store-meta{font-size:11.5px;color:var(--wk-muted);display:block;margin-top:1px;}
.wk-store-cam{font-size:11.5px;color:var(--wk-faint);font-weight:500;white-space:nowrap;flex-shrink:0;}

/* stores heatmap (Execution Summary → Stores view) */
.wk-hm{margin-top:14px;}
.wk-hm-row{display:grid;grid-template-columns:minmax(120px,1.5fr) repeat(7,minmax(0,1fr));
  gap:5px;align-items:center;margin-top:5px;}
.wk-hm-head{margin-top:0;}
.wk-hm-day{font-size:10px;color:var(--wk-muted);text-align:center;font-weight:600;
  text-transform:uppercase;letter-spacing:.3px;}
.wk-hm-store{font:inherit;font-size:12.5px;font-weight:600;color:var(--wk-ink);background:none;
  border:none;padding:0;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;}
.wk-hm-store:hover{color:var(--wk-accent);}
.wk-hm-store.ind{padding-left:16px;font-weight:500;}
/* outer (country/tier) group header — stats + aggregate heat row */
.wk-hm-outer{margin-top:18px;}
.wk-hm-outer-label{font-size:11px;font-weight:700;color:var(--wk-chip-ink);text-transform:uppercase;
  letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.wk-hm-outer-stats{color:var(--wk-faint);font-weight:600;margin-left:7px;text-transform:none;letter-spacing:0;}
/* chain sub-header — collapsible */
.wk-hm-chain{font:inherit;font-size:12px;font-weight:700;color:var(--wk-ink);background:none;
  border:none;padding:0;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;display:flex;align-items:center;gap:5px;}
.wk-hm-chain:hover{color:var(--wk-accent);}
.wk-hm-chain .chev{font-size:9px;color:var(--wk-faint);}
.wk-hm-chain .ct{color:var(--wk-faint);font-weight:600;font-size:11px;}
.wk-hm-cell{display:block;height:22px;border-radius:7px;}
.wk-hm-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--wk-muted);margin-top:10px;}
.wk-hm-swatch{width:20px;height:12px;border-radius:4px;display:inline-block;}

/* placeholder card */
.wk-ai-placeholder{background:var(--wk-card);border:1px dashed var(--wk-line);border-radius:14px;
  padding:20px 22px;margin:14px 0;text-align:center;font-size:14px;color:var(--wk-faint);}

@media(max-width:480px){
  .wk-tiles{grid-template-columns:repeat(2,1fr);}
  .wk-tile-n{font-size:19px;}
  .wk-hm-row{grid-template-columns:minmax(88px,1.2fr) repeat(7,minmax(0,1fr));gap:4px;}
  .wk-hm-store{font-size:11.5px;}
  .wk-hm-cell{height:18px;border-radius:5px;}
}
`;
