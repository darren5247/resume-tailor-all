"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PROFILE_COUNTRIES,
  PROFILE_COUNTRY_LABELS,
  type Profile,
  type ProfileCountry,
} from "@/lib/profile/schema";
import type { ProfileMeta } from "@/lib/profile/store";

const TABS = [
  { href: "/", label: "Generate" },
  { href: "/profile", label: "Profile" },
  { href: "/templates", label: "Templates" },
  { href: "/settings", label: "Settings" },
];

type Snapshot = {
  activeId: string;
  active: Profile;
  profiles: ProfileMeta[];
};

export function SiteHeader(props: {
  activeId: string;
  profiles: ProfileMeta[];
  fullName: string;
  headline: string;
  location: string;
  country: ProfileCountry;
  email: string;
  phone: string;
  linkedin: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(props.activeId);
  const [profiles, setProfiles] = useState(props.profiles);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("New profile");
  const [newCountry, setNewCountry] = useState<ProfileCountry>("US");
  const menuRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const active = profiles.find((entry) => entry.id === activeId) ?? profiles[0];
  const contactLine = [props.email, props.phone].filter(Boolean).join(" · ");
  const subtitle = [props.headline, props.location, PROFILE_COUNTRY_LABELS[props.country]]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    setActiveId(props.activeId);
    setProfiles(props.profiles);
  }, [props.activeId, props.profiles]);

  useEffect(() => {
    const onSaved = () => router.refresh();
    window.addEventListener("resume-tailor:profile-saved", onSaved);
    return () => window.removeEventListener("resume-tailor:profile-saved", onSaved);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen]);

  const applySnapshot = (snapshot: Snapshot) => {
    setActiveId(snapshot.activeId);
    setProfiles(snapshot.profiles);
    setOpen(false);
    setCreateOpen(false);
    router.refresh();
  };

  const post = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return;
      }
      applySnapshot(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const onNew = () => {
    setError(null);
    setNewLabel("New profile");
    setNewCountry("US");
    setCreateOpen(true);
  };

  const onCreateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await post({
      action: "create",
      label: newLabel.trim() || "New profile",
      country: newCountry,
    });
    router.push("/profile");
  };

  const onDelete = async () => {
    if (profiles.length <= 1) {
      setError("Keep at least one profile.");
      return;
    }
    const name = active?.label ?? "this profile";
    if (!window.confirm(`Delete profile “${name}”? This cannot be undone.`)) return;
    await post({ action: "delete", id: activeId });
  };

  const onSave = () => {
    setError(null);
    // Profile tab listens for this and persists the form; elsewhere we just refresh.
    window.dispatchEvent(new Event("resume-tailor:save-profile"));
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 -mx-6 flex flex-wrap items-start justify-between gap-6 border-b border-line bg-ink/95 px-6 py-4 backdrop-blur">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-accent">Resume Tailor</h1>
        <p className="mt-1 text-xs text-fg-muted">ATS packets from job URLs</p>
        <nav className="mt-4 flex items-center gap-1">
          {TABS.map((tab) => {
            const tabActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  tabActive
                    ? "border-accent-dim/60 bg-accent-deep/40 text-accent"
                    : "border-transparent text-fg-muted hover:border-line hover:text-fg"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-fg-muted">Profile</span>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="btn min-w-[9rem] justify-between gap-3"
              disabled={busy}
              onClick={() => setOpen((value) => !value)}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              <span className="truncate">{active?.label ?? "Select profile"}</span>
              <span className="text-fg-faint">▾</span>
            </button>

            {open && (
              <ul
                role="listbox"
                className="absolute right-0 z-20 mt-1 max-h-64 min-w-[12rem] overflow-auto rounded-md border border-line bg-panel py-1 shadow-lg"
              >
                {profiles.map((entry) => {
                  const selected = entry.id === activeId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`block w-full px-3 py-1.5 text-left text-sm ${
                          selected
                            ? "bg-accent-deep/40 text-accent"
                            : "text-fg hover:bg-panel-2"
                        }`}
                        disabled={busy}
                        onClick={() => void post({ action: "select", id: entry.id })}
                      >
                        {entry.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <button type="button" className="btn" disabled={busy} onClick={onSave} title="Refresh from disk">
            Save
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onNew}>
            New...
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void onDelete()}>
            Delete
          </button>
        </div>

        {error && <div className="text-xs text-danger">{error}</div>}

        <div className="text-right text-xs leading-relaxed">
          <div className="text-sm text-fg">{props.fullName || "Set up your profile"}</div>
          {subtitle && <div className="text-fg-muted">{subtitle}</div>}
          {contactLine && <div className="text-fg-faint">{contactLine}</div>}
          {props.linkedin && (
            <a
              href={props.linkedin.startsWith("http") ? props.linkedin : `https://${props.linkedin}`}
              target="_blank"
              rel="noreferrer"
              className="text-fg-faint underline-offset-2 hover:text-accent hover:underline"
            >
              LinkedIn
            </a>
          )}
        </div>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreateOpen(false);
          }}
        >
          <div
            ref={createRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-profile-title"
            className="w-full max-w-sm rounded-lg border border-line bg-panel p-5 shadow-xl"
          >
            <h2 id="new-profile-title" className="text-base text-fg">
              New profile
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              US profiles get per-role base resumes; Colombia generation uses only the Resume prompt.
            </p>
            <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void onCreateSubmit(event)}>
              <label className="block">
                <span className="mb-1 block text-xs text-fg-muted">Name</span>
                <input
                  className="field"
                  autoFocus
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="e.g. Juan"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-fg-muted">Country</span>
                <select
                  className="field"
                  value={newCountry}
                  onChange={(event) => setNewCountry(event.target.value as ProfileCountry)}
                >
                  {PROFILE_COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {PROFILE_COUNTRY_LABELS[country]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
