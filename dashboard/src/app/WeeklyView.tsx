"use client";

import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { WeeklyReport } from "@/lib/weekly";

const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

const wkSanitize = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"] };

// Store links in the narrative (/visits/store/<id> or /visits/visit/<id>/...) open
// the same drawer the daily report uses, rendered as a source chip.
function narrativeComponents(onOpenStore: (id: string) => void) {
  return {
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      const m = href?.match(/^\/visits\/(?:store|visit)\/([^/?#]+)/);
      if (m) return <button className="wk-chip" onClick={() => onOpenStore(m[1])}>{children}</button>;
      return <a href={href}>{children}</a>;
    },
  };
}

// Split the stored AI narrative (one markdown blob with `## Signals`, `## Alerts`,
// `## Engagements`) into one chunk per heading so each renders in its own card.
// Drops any leading pre-heading preamble and any chunk whose body is empty.
function splitNarrative(md: string): string[] {
  return md
    .split(/\n(?=## )/)
    .map((p) => p.trim())
    .filter((p) => p.startsWith("##") && p.replace(/^##.*(\n|$)/, "").trim().length > 0);
}

function fmtPct(n: number): string { return `${n}%`; }
function fmtWow(n: number | null): string | null {
  if (n === null) return null;
  return n >= 0 ? `▲ +${n}% visits vs last wk` : `▼ ${Math.abs(n)}% visits vs last wk`;
}

export function WeeklyView({
  report,
  onOpenStore,
}: {
  report: WeeklyReport;
  onOpenStore: (storeId: string) => void;
}) {
  const { stats, byDay, perCM, coverageByTier, displayByTier } = report;

  // Fold Display into Coverage: look up the visited stores for each tier|market|chain
  // so the merged "Store Updates" section can list them under each chain.
  const storesByChain = new Map<string, typeof displayByTier[number]["markets"][number]["chains"][number]["stores"]>();
  for (const tier of displayByTier)
    for (const mkt of tier.markets)
      for (const ch of mkt.chains)
        storesByChain.set(`${tier.tier}|${mkt.market}|${ch.chain}`, ch.stores);

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
            {stats.planned}
            <span className="wk-tile-of"> / {stats.executed}</span>
          </div>
          <div className="wk-tile-l">Planned / Executed</div>
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

      {/* Execution Summary */}
      <section className="wk-section">
        <h2 className="wk-sh2">
          🎯 Execution Summary
        </h2>
        {stats.planned === 0 && (
          <p className="wk-sec-note">
            {perCM.map((c) => `${c.market} ${c.visited}`).join(" · ")}
            {perCM.length > 0 ? " · " : ""}no visit plans logged this week.
          </p>
        )}
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
                <td className="wk-td c wk-num">{cm.engagements}</td>
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
      </section>

      {/* Store Updates — coverage bars (tier → market → chain) folded together with
          per-store photos, display notes & follow-ups. Click a store → drawer. */}
      <section className="wk-section">
        <h2 className="wk-sh2">
          🏪 Store Updates{" "}
          <span className="wk-sub">· coverage, then photos &amp; updates per store</span>
        </h2>
        <p className="wk-sec-note">Tap a tier → market to see chains and their visited stores. Click a store for its photos &amp; updates. Collapsed by default.</p>

        {coverageByTier.map((tier) => {
          const barPct = tier.total > 0 ? Math.round(tier.visited / tier.total * 100) : 0;
          const isLow = barPct < 30;
          return (
            <details key={tier.tier} className="wk-cov">
              <summary className="wk-cov-sum">
                <span className="wk-cv-tier">{tier.tier}</span>
                <span className="wk-cv-bar">
                  <i className={isLow ? "lo" : ""} style={{ width: `${barPct}%` }} />
                </span>
                <span className="wk-cv-n">{tier.visited} / {tier.total} · {fmtPct(barPct)}</span>
              </summary>
              <div className="wk-cv-body">
                {tier.markets.map((mkt) => (
                  <details key={mkt.market} className="wk-cov wk-cov-sub">
                    <summary className="wk-cov-sum">
                      <span className="wk-cv-mk">{MARKET_FLAG[mkt.market] ?? ""} {mkt.market}</span>
                      <span className="wk-cv-n">{mkt.visited} / {mkt.total}</span>
                    </summary>
                    <div className="wk-cv-body">
                      {mkt.chains.map((ch) => {
                        const stores = storesByChain.get(`${tier.tier}|${mkt.market}|${ch.chain}`) ?? [];
                        return (
                          <div key={ch.chain} className="wk-su-chain">
                            <div className="wk-su-chain-hd">
                              <span>{ch.chain}</span>
                              <span className={ch.visited === ch.total && ch.total > 0 ? "wk-ok" : ch.visited === 0 ? "wk-bad" : "wk-cv-n"}>
                                {ch.visited} / {ch.total}
                              </span>
                            </div>
                            {stores.map((store) => (
                              <div
                                key={store.storeId}
                                className="wk-dsp-store"
                                onClick={() => onOpenStore(store.storeId)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenStore(store.storeId); }}
                              >
                                <div className="wk-ds-name">
                                  {store.store}
                                  <span className="wk-ds-cam">
                                    📷 {store.photos} · ↗
                                  </span>
                                </div>
                                {store.displayNote && (
                                  <div className="wk-ds-note">{store.displayNote}</div>
                                )}
                                {store.followUps.length > 0 && (
                                  <div className="wk-ds-fu-wrap">
                                    {store.followUps.map((fu, i) => (
                                      <span key={i} className="wk-fu">
                                        {fu.title}{fu.ageDays > 0 ? ` · ${fu.ageDays}d` : ""}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
      </section>

      {/* AI narrative — one card each for Signals / Alerts / Engagements (stored, editable). */}
      {narrativeSections.length > 0 ? (
        narrativeSections.map((md, i) => (
          <section key={i} className="wk-section wk-narrative">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, wkSanitize]]}
              components={narrativeComponents(onOpenStore)}
            >
              {md}
            </ReactMarkdown>
          </section>
        ))
      ) : (
        <div className="wk-ai-placeholder">
          🔔 Signals · 🚨 Alerts · 🤝 Engagements — AI narrative generates weekly (coming soon)
        </div>
      )}
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
.wk-sh2{font-size:15px;font-weight:700;margin:0 0 4px;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
.wk-sub{font-size:12px;font-weight:400;color:var(--wk-muted);}
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

/* coverage by tier */
.wk-cov{border:1px solid var(--wk-line);border-radius:10px;margin:8px 0;overflow:hidden;}
.wk-cov-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;
  padding:11px 14px;font-size:13.5px;}
.wk-cov-sum::-webkit-details-marker{display:none;}
.wk-cov-sum::before{content:"\\25B8";color:var(--wk-faint);transition:.2s;font-size:11px;flex-shrink:0;}
.wk-cov[open]>.wk-cov-sum::before{transform:rotate(90deg);}
.wk-cv-tier{font-weight:700;width:26px;flex-shrink:0;}
.wk-cv-bar{flex:1;height:8px;background:var(--wk-line);border-radius:6px;overflow:hidden;max-width:230px;}
.wk-cv-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--wk-accent2),var(--wk-accent));border-radius:6px;}
.wk-cv-bar i.lo{background:linear-gradient(90deg,#d79a86,#b4621f);}
.wk-cv-n{font-variant-numeric:tabular-nums;color:var(--wk-muted);font-size:12.5px;
  margin-left:auto;font-weight:600;white-space:nowrap;}
.wk-cv-body{padding:2px 14px 12px;border-top:1px solid var(--wk-line);background:#fbfaf7;}
.wk-ok{color:var(--wk-accent);font-weight:600;}
.wk-bad{color:var(--wk-alert);font-weight:600;}
.wk-cv-mk{font-size:11px;font-weight:700;color:var(--wk-chip-ink);background:var(--wk-chip);
  padding:2px 8px;border-radius:5px;}

/* nested sub-details within coverage */
.wk-cov-sub{border:0;border-radius:0;margin:0;border-bottom:1px solid #efece5;}
.wk-cov-sub:last-child{border-bottom:none;}
.wk-cov-sub>.wk-cov-sum{padding:9px 2px;}
.wk-cov-sub>.wk-cv-body{background:transparent;border-top:1px dashed #e8e4db;padding:2px 2px 8px 12px;}

/* store-updates: per-chain group with its visited stores */
.wk-su-chain{padding:2px 0;}
.wk-su-chain-hd{display:flex;justify-content:space-between;font-size:11px;font-weight:700;
  color:var(--wk-chip-ink);text-transform:uppercase;letter-spacing:.3px;
  margin:8px 0 1px 2px;padding-bottom:3px;border-bottom:1px solid #efece5;}
.wk-dsp-store{padding:7px 0 7px 12px;border-bottom:1px solid #efece5;cursor:pointer;
  transition:background .12s;}
.wk-dsp-store:last-child{border-bottom:none;}
.wk-dsp-store:hover{background:#f4f1ea;}
.wk-ds-name{font-size:13.5px;font-weight:600;display:flex;justify-content:space-between;
  gap:8px;align-items:baseline;}
.wk-ds-cam{font-size:11px;color:var(--wk-faint);font-weight:500;white-space:nowrap;}
.wk-ds-note{font-size:12.5px;color:var(--wk-muted);margin-top:2px;}
.wk-ds-fu-wrap{margin-top:4px;}
.wk-fu{display:inline-block;font-size:12px;background:var(--wk-warn-soft);color:var(--wk-warn);
  padding:2px 9px;border-radius:20px;margin:2px 3px 2px 0;}

/* narrative (Signals / Alerts / Engagements) */
.wk-narrative h2{font-size:15px;font-weight:700;margin:0 0 8px;}
.wk-narrative ul{margin:0;padding-left:18px;}
.wk-narrative li{padding:4px 0;font-size:13.5px;line-height:1.5;}
.wk-narrative p{font-size:13.5px;margin:6px 0;}
.wk-narrative strong{font-weight:700;}
.wk-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--wk-chip-ink);
  background:var(--wk-chip);border:1px solid transparent;padding:1px 9px;border-radius:20px;
  cursor:pointer;margin:0 1px;transition:.15s;}
.wk-chip:hover{background:#e1e6ec;border-color:#cdd6df;}
.wk-chip::before{content:"↗";font-size:10px;opacity:.5;}

/* placeholder card */
.wk-ai-placeholder{background:var(--wk-card);border:1px dashed var(--wk-line);border-radius:14px;
  padding:20px 22px;margin:14px 0;text-align:center;font-size:14px;color:var(--wk-faint);}

@media(max-width:480px){
  .wk-tiles{grid-template-columns:repeat(2,1fr);}
  .wk-tile-n{font-size:19px;}
}
`;
