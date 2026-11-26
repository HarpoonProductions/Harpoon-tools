// Fluke editor — the library: saved pieces in the Story Engine's Supabase project.
//
// Sign-in is Supabase Auth email links, invite only; the tables are locked to people on animate_team
// (see supabase/animate-library.sql). The project address and public key are typed in once per browser
// and kept there, so they're never published in this (public) site's code.
//
// Versions follow the HSE backup model: snapshots live on the piece's own row (newest first, max 50);
// "Duplicate" makes a genuinely new piece; "Restore" swaps a snapshot in, keeping the same piece.
//
// For testing on a local copy only, ?library=mock swaps Supabase for an in-browser pretend backend.

const CONF_KEY = "harpoon-animate-library-conf";
const REF_KEY = "harpoon-animate-library-ref";
const MAX_SNAPSHOTS = 50;
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const LIST_COLUMNS = "id,title,client,client_label,story,scene,updated_at,updated_by,created_at";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export class Conflict extends Error { constructor(row) { super("Someone else saved this piece since you opened it"); this.row = row; } }

// ---------------------------------------------------------------- backends
function supabaseBackend(conf) {
  let client = null;
  const db = async () => {
    if (client) return client;
    const { createClient } = await import(SUPABASE_JS);
    client = createClient(conf.url, conf.key, { auth: { persistSession: true, detectSessionInUrl: true, storageKey: "harpoon-animate-auth" } });
    return client;
  };
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    kind: "supabase",
    async session() { const c = await db(); const { data } = await c.auth.getSession(); return data.session ? { email: data.session.user.email } : null; },
    async signIn(email) {
      const c = await db();
      check(await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }));
    },
    async signOut() { const c = await db(); await c.auth.signOut(); },
    async verify({ token_hash, type }) { const c = await db(); check(await c.auth.verifyOtp({ token_hash, type })); },
    async isTeam() { const c = await db(); return (check(await c.from("animate_team").select("email").limit(1)) || []).length > 0; },
    async list() { const c = await db(); return check(await c.from("animate_scenes").select(LIST_COLUMNS).is("archived_at", null).order("updated_at", { ascending: false }).limit(300)); },
    async get(id) { const c = await db(); return check(await c.from("animate_scenes").select("*").eq("id", id).single()); },
    async create(row) { const c = await db(); return check(await c.from("animate_scenes").insert(row).select().single()); },
    async update(id, fields, expectedUpdatedAt) {
      const c = await db();
      let q = c.from("animate_scenes").update(fields).eq("id", id);
      if (expectedUpdatedAt) q = q.eq("updated_at", expectedUpdatedAt);
      const { data, error } = await q.select();
      if (error) throw new Error(error.message);
      if (!data.length) throw new Conflict(await this.get(id).catch(() => null));
      return data[0];
    },
  };
}

// In-browser pretend backend: the same behaviour, kept in localStorage. Local copies only.
function mockBackend() {
  const KEY = "harpoon-animate-mock-library";
  const rows = () => store.get(KEY) || [];
  const write = (r) => store.set(KEY, r);
  const now = () => new Date(Date.now() + Math.random()).toISOString();
  let who = store.get(KEY + "-session");
  return {
    kind: "mock",
    async session() { return who ? { email: who } : null; },
    async signIn(email) { who = email; store.set(KEY + "-session", email); },
    async signOut() { who = null; store.set(KEY + "-session", null); },
    async verify() { who = "invited@example.com"; store.set(KEY + "-session", who); },
    async isTeam() { return !!who; },
    async list() { return rows().filter((r) => !r.archived_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); },
    async get(id) { const r = rows().find((x) => x.id === id); if (!r) throw new Error("Not found"); return structuredClone(r); },
    async create(row) {
      const r = { id: crypto.randomUUID(), snapshots: [], archived_at: null, created_at: now(), ...row, updated_at: now() };
      write([...rows(), r]); return structuredClone(r);
    },
    async update(id, fields, expectedUpdatedAt) {
      const all = rows(); const r = all.find((x) => x.id === id);
      if (!r) throw new Error("Not found");
      if (expectedUpdatedAt && r.updated_at !== expectedUpdatedAt) throw new Conflict(structuredClone(r));
      Object.assign(r, fields, { updated_at: now() }); write(all); return structuredClone(r);
    },
  };
}

// ---------------------------------------------------------------- state
let api = null;          // editor hooks
let backend = null;
let me = null;           // { email }
let team = false;
let rowsCache = [];
let ref = store.get(REF_KEY); // { id, updated_at, saved } — the library piece the editor is working on

const mockAllowed = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("library") === "mock";
function makeBackend() {
  if (mockAllowed()) return mockBackend();
  const conf = store.get(CONF_KEY);
  return conf?.url && conf?.key ? supabaseBackend(conf) : null;
}
const setRef = (r) => { ref = r; store.set(REF_KEY, r); updateStatus(); };
const sceneJson = () => JSON.stringify(api.getScene());
export const isDirty = () => !!ref && ref.saved !== sceneJson();

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "value") el.value = v; else el.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && c !== false && el.append(c));
  return el;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const who = (email) => (email || "").split("@")[0];
const rowFields = (scene, extra = {}) => ({
  title: scene.title || "Untitled piece", client: scene.kit?.id || null, client_label: scene.kit?.label || extra.client_label || null,
  scene, ...extra,
});

// A small dialog: resolves with the chosen button's value (and the text typed, if there's a field), or null.
function ask({ title, text, field, buttons }) {
  return new Promise((resolve) => {
    const input = field ? h("input", { type: "text", value: field.value || "", placeholder: field.placeholder || "", "aria-label": field.label }) : null;
    const done = (v) => { box.remove(); document.removeEventListener("keydown", onKey, true); resolve(v === null ? null : { value: v, text: input?.value.trim() || "" }); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } if (e.key === "Enter" && input && document.activeElement === input) done(buttons.find((b) => b.primary)?.value ?? null); };
    const box = h("div", { class: "modal open ask", "aria-hidden": "false" },
      h("div", { class: "modal__box ask-box", role: "alertdialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "modal__head" }, h("h2", {}, title)),
        h("div", { class: "modal__body" }, text ? h("p", {}, text) : null, field ? h("label", { class: "f" }, h("span", {}, field.label), input) : null,
          h("div", { class: "actions" }, buttons.map((b) => h("button", { type: "button", class: b.primary ? "primary" : b.danger ? "danger" : "secondary", onclick: () => done(b.value) }, b.label)),
            h("button", { type: "button", class: "secondary", onclick: () => done(null) }, "Cancel")))));
    document.body.append(box); document.addEventListener("keydown", onKey, true);
    (input || box.querySelector("button")).focus();
  });
}

// ---------------------------------------------------------------- save / open
export async function save({ asNew = false } = {}) {
  if (!backend) return openLibrary();
  if (!me || !team) return openLibrary();
  const scene = api.getScene();
  try {
    let row;
    if (ref && !asNew) row = await backend.update(ref.id, { ...rowFields(scene), updated_by: me.email }, ref.updated_at);
    else {
      const a = await ask({ title: asNew ? "Save as a new piece" : "Save to the library",
        text: `“${scene.title || "Untitled piece"}”${scene.kit ? ` · ${scene.kit.label}` : ""}`,
        field: { label: "Which story is it for? (optional)", placeholder: "e.g. Winter Giving 2026" },
        buttons: [{ label: "Save", value: "save", primary: true }] });
      if (!a) return null;
      row = await backend.create({ ...rowFields(scene, { story: a.text || null }), created_by: me.email, updated_by: me.email });
    }
    setRef({ id: row.id, updated_at: row.updated_at, saved: JSON.stringify(row.scene) });
    api.toast(`Saved “${row.title}” to the library`);
    return row;
  } catch (e) {
    if (e instanceof Conflict) return resolveConflict(e.row);
    api.toast("Couldn't save: " + e.message);
  }
}
async function resolveConflict(theirs) {
  const by = theirs ? `${who(theirs.updated_by)} at ${new Date(theirs.updated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "someone";
  const a = await ask({ title: "Someone else saved this piece",
    text: `${by} saved a newer version after you opened it. Keep yours as a separate piece, or replace theirs? If you replace it, theirs is kept in the version history.`,
    buttons: [{ label: "Save mine as a new piece", value: "copy", primary: true }, ...(theirs ? [{ label: "Replace theirs with mine", value: "replace", danger: true }] : [])] });
  const choice = a?.value;
  if (choice === "copy") return save({ asNew: true });
  if (choice === "replace" && theirs) {
    // keep theirs as a version first, so nothing is lost
    await addSnapshot(theirs.id, `Their version, replaced by ${who(me.email)}`, theirs.scene, theirs);
    const fresh = await backend.get(theirs.id);
    setRef({ id: fresh.id, updated_at: fresh.updated_at, saved: ref?.saved });
    return save();
  }
}
async function addSnapshot(id, note, scene, row = null) {
  row ||= await backend.get(id);
  const snaps = [{ at: new Date().toISOString(), by: me.email, note: note || "", scene }, ...(row.snapshots || [])].slice(0, MAX_SNAPSHOTS);
  return backend.update(id, { snapshots: snaps }, row.updated_at);
}
async function openRow(id, { asCopy = false, scene = null } = {}) {
  if (isDirty() && !confirm("This piece has changes that aren't saved to the library. Open another piece anyway? (You can undo.)")) return;
  const row = await backend.get(id);
  const s = structuredClone(scene || row.scene);
  if (asCopy) {
    s.title = `${s.title || row.title} (copy)`;
    s.id = `${s.id || "piece"}-copy`;
    api.loadScene(s); setRef(null);
    api.toast("Opened as a new piece — save it to add it to the library");
  } else {
    api.loadScene(s);
    setRef({ id: row.id, updated_at: row.updated_at, saved: JSON.stringify(row.scene) });
    api.toast(`Opened “${row.title}”`);
  }
  closeLibrary();
}

// ---------------------------------------------------------------- status chip in the header
function updateStatus() {
  const chip = document.getElementById("libStatus"); if (!chip || !api) return;
  // the chip is also the Save button (as is ⌘S)
  if (!ref) { chip.textContent = "Save to library"; chip.className = "lib-status none"; return; }
  if (isDirty()) { chip.textContent = "Save changes"; chip.className = "lib-status dirty"; }
  else { chip.textContent = "Saved ✓"; chip.className = "lib-status ok"; }
}
export const refreshStatus = updateStatus;
export function forgetRef() { setRef(null); }

// ---------------------------------------------------------------- the library window
let modal = null;
let placing = false; // the library opened to choose a piece to place inside this one
function closeLibrary() { modal?.remove(); modal = null; }
export async function openLibrary({ place = false } = {}) {
  closeLibrary();
  placing = !!place;
  const body = h("div", { class: "modal__body lib-body" }, h("p", { class: "helper" }, "Loading…"));
  modal = h("div", { class: "modal open", "aria-hidden": "false", onclick: (e) => { if (e.target === modal) closeLibrary(); } },
    h("div", { class: "modal__box wide lib-box", role: "dialog", "aria-modal": "true", "aria-label": "Library" },
      h("div", { class: "modal__head" }, h("h2", {}, placing ? "Place a piece inside this one" : "Library"), h("button", { type: "button", class: "secondary mini", onclick: closeLibrary }, "Close")),
      body));
  document.body.append(modal);
  await render(body);
}

async function render(body) {
  backend ||= makeBackend();
  if (!backend) return body.replaceChildren(...connectView(body));
  await finishEmailLink();
  try { me = await backend.session(); } catch (e) { return body.replaceChildren(h("p", { class: "lib-error" }, "Couldn't reach the library: " + e.message), ...connectView(body)); }
  if (!me) return body.replaceChildren(...signInView(body));
  try { team = await backend.isTeam(); } catch { team = false; }
  if (!team) return body.replaceChildren(
    h("p", {}, `You're signed in as ${me.email}, but that address isn't on the Fluke team list.`),
    h("p", { class: "helper" }, "Ask Giles to add you (animate_team table in Supabase)."),
    h("button", { type: "button", class: "secondary", onclick: async () => { await backend.signOut(); render(body); } }, "Sign out"));
  body.replaceChildren(h("p", { class: "helper" }, "Loading pieces…"));
  try { rowsCache = await backend.list(); } catch (e) { return body.replaceChildren(h("p", { class: "lib-error" }, "Couldn't load the library: " + e.message)); }
  body.replaceChildren(...await libraryView(body));
}

function connectView(body) {
  const url = h("input", { type: "url", placeholder: "https://xxxxxxxx.supabase.co", "aria-label": "Supabase project address" });
  const key = h("input", { type: "text", placeholder: "eyJ… (the anon / public key)", "aria-label": "Supabase public key" });
  const conf = store.get(CONF_KEY); if (conf) { url.value = conf.url; key.value = conf.key; }
  return [
    h("h3", {}, "Connect to the library"),
    h("p", { class: "helper" }, "The library lives in the Story Engine's Supabase project. Paste its address and public (anon) key once — they're kept in this browser only, never in the site's code. Giles has them; in Supabase they're under Project Settings → API."),
    h("label", { class: "f" }, h("span", {}, "Project address"), url),
    h("label", { class: "f" }, h("span", {}, "Public (anon) key"), key),
    h("div", { class: "actions" }, h("button", { type: "button", class: "primary", onclick: () => {
      const u = url.value.trim().replace(/\/$/, ""), k = key.value.trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u) || k.length < 20) return api.toast("That doesn't look like a Supabase address and key");
      store.set(CONF_KEY, { url: u, key: k }); backend = null; render(body);
    } }, "Connect")),
  ];
}

function signInView(body) {
  const email = h("input", { type: "email", placeholder: "you@harpoon.productions", "aria-label": "Your email", autocomplete: "email" });
  const status = h("p", { class: "helper" });
  const send = async () => {
    const v = email.value.trim(); if (!/^\S+@\S+\.\S+$/.test(v)) return api.toast("Enter your email address");
    status.textContent = "Sending…";
    try {
      await backend.signIn(v);
      if (backend.kind === "mock") return render(body);
      status.textContent = `Check ${v} for a sign-in link. Open it in this browser and you'll come straight back here, signed in.`;
    } catch (e) { status.textContent = /signups not allowed|not found|Signups/i.test(e.message) ? "That address hasn't been invited yet — ask Giles." : "Couldn't send the link: " + e.message; }
  };
  email.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  return [
    h("h3", {}, "Sign in to the library"),
    h("p", { class: "helper" }, "Invite only. Enter your email and we'll send you a sign-in link — no password."),
    h("div", { class: "lib-signin" }, email, h("button", { type: "button", class: "primary", onclick: send }, "Email me a link")),
    status,
    h("button", { type: "button", class: "link-btn", onclick: () => { store.set(CONF_KEY, null); backend = null; render(body); } }, "Use a different Supabase project"),
  ];
}

async function libraryView(body) {
  const current = ref ? rowsCache.find((r) => r.id === ref.id) : null;
  const clients = [...new Map(rowsCache.filter((r) => r.client_label).map((r) => [r.client_label, r.client_label])).keys()].sort();
  let q = "", client = "";
  const grid = h("div", { class: "lib-grid" });
  const drawGrid = () => {
    const words = q.trim().toLowerCase();
    const shown = rowsCache.filter((r) => (!client || r.client_label === client) &&
      (!words || [r.title, r.story, r.client_label].join(" ").toLowerCase().includes(words)));
    grid.replaceChildren(...(shown.length ? shown.map((r) => card(r, body)) : [h("p", { class: "helper" }, rowsCache.length ? "Nothing matches." : "No pieces saved yet. Save this one to start the library.")]));
  };
  const search = h("input", { type: "search", placeholder: "Search titles and stories…", "aria-label": "Search the library", oninput: (e) => { q = e.target.value; drawGrid(); } });
  const pickClient = h("select", { "aria-label": "Client", onchange: (e) => { client = e.target.value; drawGrid(); } },
    h("option", { value: "" }, "All clients"), clients.map((c) => h("option", { value: c }, c)));
  drawGrid();
  return [
    h("div", { class: "lib-bar" },
      h("span", { class: "helper" }, `Signed in as ${me.email}${backend.kind === "mock" ? " (test library)" : ""}`),
      h("button", { type: "button", class: "link-btn", onclick: async () => { await backend.signOut(); me = null; render(body); } }, "Sign out")),
    placing ? h("p", { class: "helper lib-placing" }, `Choose a piece to add to “${api.getScene().title || "this piece"}” as one movable, resizable layer. It's a copy: changing the original later won't change it.`)
      : currentView(current, body),
    h("div", { class: "lib-tools" }, search, pickClient),
    grid,
  ];
}

function currentView(row, body) {
  const scene = api.getScene();
  if (!row) return h("section", { class: "lib-current" },
    h("div", {}, h("b", {}, scene.title || "This piece"), h("span", { class: "helper" }, " isn't in the library yet.")),
    h("button", { type: "button", class: "primary", onclick: async () => { if (await save()) render(body); } }, "Save to library"));
  const note = h("input", { type: "text", placeholder: "What changed? (optional)", "aria-label": "Version note" });
  const versions = h("div", { class: "lib-versions" }, h("p", { class: "helper" }, "Loading versions…"));
  backend.get(row.id).then((full) => {
    const snaps = full.snapshots || [];
    versions.replaceChildren(...(snaps.length ? snaps.map((s, i) => h("div", { class: "lib-version" },
      h("span", {}, h("b", {}, new Date(s.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })), ` · ${who(s.by)}${s.note ? " · " + s.note : ""}`),
      h("button", { type: "button", class: "secondary mini", onclick: () => restore(row.id, i, body) }, "Restore"),
      h("button", { type: "button", class: "secondary mini", onclick: () => openRow(row.id, { asCopy: true, scene: s.scene }) }, "Open as copy")))
      : [h("p", { class: "helper" }, "No saved versions yet. Save one before big changes.")]));
  }).catch((e) => versions.replaceChildren(h("p", { class: "lib-error" }, e.message)));
  return h("section", { class: "lib-current" },
    h("div", {}, h("b", {}, row.title), h("span", { class: "helper" }, ` · in the library${row.story ? " · " + row.story : ""} · ${isDirty() ? "unsaved changes" : "saved"}`)),
    h("div", { class: "lib-row" },
      h("button", { type: "button", class: "primary", onclick: async () => { await save(); render(body); } }, "Save changes"),
      note,
      h("button", { type: "button", class: "secondary", onclick: async () => {
        const saved = await save(); if (!saved) return;
        try { const r = await addSnapshot(saved.id, note.value.trim(), saved.scene, saved); setRef({ ...ref, updated_at: r.updated_at }); api.toast("Version saved"); render(body); }
        catch (e) { api.toast("Couldn't save the version: " + e.message); }
      } }, "Save as a version")),
    h("details", {}, h("summary", {}, "Version history"), versions));
}

async function restore(id, index, body) {
  const row = await backend.get(id);
  const snap = row.snapshots[index]; if (!snap) return;
  if (!confirm(`Restore the version from ${new Date(snap.at).toLocaleString("en-GB")}? The current version is kept in the history first.`)) return;
  try {
    // keep what's there now as a version, then swap the chosen one in — same piece, same id
    const kept = await addSnapshot(id, "Before restoring an earlier version", row.scene, row);
    const r = await backend.update(id, { scene: snap.scene, title: snap.scene.title || row.title, updated_by: me.email }, kept.updated_at);
    api.loadScene(structuredClone(r.scene));
    setRef({ id: r.id, updated_at: r.updated_at, saved: JSON.stringify(r.scene) });
    api.toast("Restored"); render(body);
  } catch (e) { api.toast(e instanceof Conflict ? "Someone saved this piece just now — reopen the library and try again" : "Couldn't restore: " + e.message); }
}

function card(r, body) {
  const thumbScene = { ...structuredClone(r.scene), id: "lib-" + r.id.slice(0, 8) }; // unique CSS scope per card
  delete thumbScene.mobile; // thumbnails are narrow: show the desktop design, not the phone layout
  const thumb = h("div", { class: "lib-thumb f-end" });
  thumb.innerHTML = api.renderStatic(thumbScene);
  const isCurrent = ref && ref.id === r.id;
  const place = () => { closeLibrary(); api.placeScene(r.scene); };
  if (placing) return h("article", { class: `lib-card${isCurrent ? " current" : ""}` },
    h("button", { type: "button", class: "lib-open", title: isCurrent ? "This is the piece you're editing" : "Place this piece", disabled: isCurrent || !r.scene, onclick: place }, thumb),
    h("div", { class: "lib-meta" },
      h("b", {}, r.title),
      h("span", {}, [r.client_label, r.story].filter(Boolean).join(" · ") || "No client"),
      h("span", { class: "helper" }, `${ago(r.updated_at)}${isCurrent ? " · open now" : ""}`)),
    h("div", { class: "lib-actions" }, isCurrent ? h("span", { class: "helper" }, "Can't place a piece inside itself")
      : h("button", { type: "button", class: "primary mini", onclick: place }, "Place")));
  return h("article", { class: `lib-card${isCurrent ? " current" : ""}` },
    h("button", { type: "button", class: "lib-open", title: "Open this piece", onclick: () => openRow(r.id) }, thumb),
    h("div", { class: "lib-meta" },
      h("b", {}, r.title),
      h("span", {}, [r.client_label, r.story].filter(Boolean).join(" · ") || "No client"),
      h("span", { class: "helper" }, `${ago(r.updated_at)}${r.updated_by ? " · " + who(r.updated_by) : ""}${isCurrent ? " · open now" : ""}`)),
    h("div", { class: "lib-actions" },
      h("button", { type: "button", class: "secondary mini", onclick: () => openRow(r.id) }, "Open"),
      h("button", { type: "button", class: "secondary mini", onclick: () => openRow(r.id, { asCopy: true }) }, "Duplicate"),
      r.scene && !isCurrent ? h("button", { type: "button", class: "secondary mini", title: "Add a copy of this piece to the one you're editing, as one movable layer",
        onclick: () => { closeLibrary(); api.placeScene(r.scene); } }, "Place in this piece") : null,
      h("button", { type: "button", class: "secondary mini", onclick: async () => {
        if (!confirm(`Archive “${r.title}”? It leaves the library list; it isn't deleted and can be brought back from Supabase.`)) return;
        try { await backend.update(r.id, { archived_at: new Date().toISOString(), updated_by: me.email }); if (isCurrent) setRef(null); api.toast("Archived"); render(body); }
        catch (e) { api.toast("Couldn't archive: " + e.message); }
      } }, "Archive")));
}

// ---------------------------------------------------------------- start
// The branded invite and sign-in emails link straight here with ?token_hash=…&type=…
// (Supabase's own links go to the project's Site URL, which belongs to HSE). The token is held for this tab
// until the browser is connected to the library, then exchanged for a session.
const PENDING_KEY = "fluke-pending-email-link";
function takeEmailLink() {
  const q = new URLSearchParams(location.search);
  const token_hash = q.get("token_hash"), type = q.get("type");
  if (!token_hash || !type) return;
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ token_hash, type })); } catch { /* storage blocked */ }
  q.delete("token_hash"); q.delete("type");
  history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
}
async function finishEmailLink() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(PENDING_KEY)); } catch { /* none */ }
  if (!p || !backend) return;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* fine */ }
  try { await backend.verify(p); api.toast(p.type === "invite" ? "Welcome to Fluke — you're signed in" : "Signed in"); }
  catch (e) { api.toast("That sign-in link has expired or was already used. Ask for a new one below."); }
}

export async function initLibrary(a) {
  api = a;
  takeEmailLink();
  let pending = false;
  try { pending = !!sessionStorage.getItem(PENDING_KEY); } catch { /* none */ }
  if (pending) { openLibrary(); return; } // connects first if needed, then finishes the sign-in
  // finish an email-link sign-in that just landed here
  if (/access_token=|error_description=/.test(location.hash)) {
    backend ||= makeBackend();
    if (backend) {
      try { me = await backend.session(); } catch { /* shown when the library opens */ }
      history.replaceState(null, "", location.pathname + location.search);
      if (me) { api.toast(`Signed in as ${me.email}`); openLibrary(); }
    }
  }
}
