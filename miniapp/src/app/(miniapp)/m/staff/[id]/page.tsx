"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { initTelegram } from "../../telegram-init";
import { useSwipeBack } from "@/lib/useSwipeBack";

interface StaffDetail {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  is_ally: boolean;
  age: number | null;
  bio: string | null;
  store_id: string;
  store_name: string;
  stats: { engagements: number; trained: number; products: number; lastEngagedAt: string | null };
  trainingHistory: Array<{ visit_id: string; visit_date: string; products: string[] }>;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [staff, setStaff]   = useState<StaffDetail | null>(null);
  const [initData, setInit] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  useSwipeBack();

  useEffect(() => {
    (async () => {
      const data = await initTelegram();
      if (!data) { setError("Open this from inside Telegram."); return; }
      setInit(data);
      const res = await fetch(`/api/m/staff/${id}`, { headers: { Authorization: `tma ${data}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setStaff((await res.json()).staff);
    })().catch((e) => setError(String(e)));
  }, [id]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-400">{error}</p>
      </main>
    );
  }
  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    );
  }

  const { stats } = staff;
  const initials = staff.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="min-h-screen pb-12">
      {/* Header */}
      <header className="bg-white border-b border-ink-100 px-4 pt-4 pb-4">
        <Link
          href={`/m/store/${staff.store_id}`}
          className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-3"
        >
          ‹ {staff.store_name}
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-sm font-extrabold text-ink-500">
            {initials || "?"}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-ink-700 leading-tight">{staff.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {staff.role && <span className="text-[12px] text-ink-400">{staff.role}</span>}
              {staff.is_ally && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-section-amber-bg)] text-[var(--color-tc-600)]">
                  ⭐ Ally
                </span>
              )}
            </div>
          </div>
        </div>
        {stats.engagements > 0 && (
          <>
            <div className="grid grid-cols-3 gap-px mt-3.5 rounded-xl overflow-hidden bg-ink-100 border border-ink-100">
              <StaffStat value={stats.engagements} label={stats.engagements === 1 ? "engagement" : "engagements"} />
              <StaffStat value={stats.trained} label="trained" />
              <StaffStat value={stats.products} label="products" />
            </div>
            <p className="text-[11px] text-ink-300 mt-2.5">
              Lifetime at this store{stats.lastEngagedAt ? ` · last engaged ${fmtDate(stats.lastEngagedAt)}` : ""}
            </p>
          </>
        )}
      </header>

      {/* Profile (age + bio) — editable */}
      <ProfileCard staff={staff} initData={initData} onSaved={setStaff} />

      {/* Training history */}
      <section className="mt-4">
        <h2 className="px-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-300">
          Training history
        </h2>
        {staff.trainingHistory.length === 0 ? (
          <div className="mx-4 rounded-2xl border border-ink-100 bg-white p-5 text-center">
            <p className="text-sm text-ink-300">No product training logged yet.</p>
          </div>
        ) : (
          <ul className="space-y-2 px-3.5">
            {staff.trainingHistory.map((t) => (
              <li key={t.visit_id}>
                <Link
                  href={`/m/visit/${t.visit_id}`}
                  className="block rounded-[18px] border border-ink-100 bg-white p-3.5 shadow-sm active:bg-ink-50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-ink-700">{fmtDate(t.visit_date)}</span>
                    <span className="text-[11px] text-ink-300">{t.products.length} product{t.products.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.products.map((p, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-section-purple-bg)] text-[#5B2DB5]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StaffStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white py-2 text-center">
      <div className="text-[17px] font-black text-ink-700 leading-none">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-ink-300 mt-1">{label}</div>
    </div>
  );
}

function ProfileCard({
  staff,
  initData,
  onSaved,
}: {
  staff: StaffDetail;
  initData: string | null;
  onSaved: (s: StaffDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [age, setAge]   = useState(staff.age != null ? String(staff.age) : "");
  const [bio, setBio]   = useState(staff.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const hasProfile = staff.age != null || (staff.bio && staff.bio.trim());

  async function save() {
    if (!initData) return;
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/m/staff/${staff.id}`, {
      method: "PATCH",
      headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
      body: JSON.stringify({ age: age.trim() === "" ? null : age.trim(), bio: bio.trim() === "" ? null : bio.trim() }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body.error ?? `Failed (${res.status})`);
      return;
    }
    onSaved((await res.json()).staff);
    setEditing(false);
  }

  return (
    <section className="mt-4">
      <div className="px-4 pb-2 flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-300">Profile</h2>
        {!editing && (
          <button
            onClick={() => { setAge(staff.age != null ? String(staff.age) : ""); setBio(staff.bio ?? ""); setEditing(true); }}
            className="text-[11px] font-bold text-ink-400 bg-ink-100 rounded-lg px-2.5 py-1"
          >
            {hasProfile ? "Edit" : "+ Add"}
          </button>
        )}
      </div>

      <div className="mx-4 rounded-2xl border border-ink-100 bg-white p-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-300 mb-1">Age</label>
              <input
                type="number"
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="—"
                className="w-24 rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-300 mb-1">Profile / notes</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder="What's helpful to remember about this person — interests, relationship, role nuances…"
                className="w-full rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-700 leading-relaxed"
              />
            </div>
            {err && <p className="text-[12px] text-[var(--color-status-bad-fg)]">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-[var(--color-tc-600)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setErr(null); }}
                className="rounded-lg bg-ink-100 px-4 py-2 text-sm font-bold text-ink-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : hasProfile ? (
          <div className="space-y-2">
            {staff.age != null && (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-ink-300 font-semibold w-10">Age</span>
                <span className="text-ink-700 font-semibold">{staff.age}</span>
              </div>
            )}
            {staff.bio && staff.bio.trim() && (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-500">{staff.bio}</p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-300">No profile yet. Tap <strong>+ Add</strong> to record an age and notes.</p>
        )}
      </div>
    </section>
  );
}
