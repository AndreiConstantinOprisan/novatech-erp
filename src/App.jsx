import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from "react";

/* =========================================================================
   NOVATECH PROIECT SRL — Sistem de gestiune (prototip interactiv)
   Bazat pe caietul de specificații tehnice: Lucrări, Personal, Clienți,
   Financiar (incl. TVA), Patrimoniu.
   ========================================================================= */

const STORAGE_KEY = "novatech-app-data-v1";
const TODAY = new Date();

import { supabase, supabaseConfigured } from "./supabaseClient";

/* ---------------------------- Adaptor stocare locală (fallback dacă Supabase nu e configurat încă) ---------------------------- */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix) {
      const keys = Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix));
      return { keys };
    },
  };
}

/* ---------------------------- Autentificare, roluri, 2FA, blocare automată ---------------------------- */

const MINUTE_BLOCARE = 10; // după atâtea minute fără activitate, aplicația se blochează
const SecCtx = createContext({ rol: "admin", mfaActiv: false, factorId: null, session: null, reevalueaza: () => {}, blocheaza: () => {} });
const useSec = () => useContext(SecCtx);

function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = se verifică, null = neautentificat, obiect = autentificat
  const [authError, setAuthError] = useState("");
  const locala = !supabaseConfigured;
  const rolTest = (() => { try { return locala ? localStorage.getItem("novatech-test-role") : null; } catch (e) { return null; } })();
  const [acces, setAcces] = useState(locala ? { stare: "ok", rol: rolTest || "admin", mfaActiv: false } : { stare: "verific" });

  const evalueaza = useCallback(async (sess) => {
    if (!supabaseConfigured) return;
    if (!sess) { setAcces({ stare: "login" }); return; }
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: fl } = await supabase.auth.mfa.listFactors();
      const factor = (fl?.totp || []).find((f) => f.status === "verified");
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setAcces({ stare: "mfa", factorId: factor?.id || null });
        return;
      }
      const { data: r, error } = await supabase.from("user_roles").select("role").maybeSingle();
      if (error) { setAcces({ stare: "eroare", mesaj: error.message }); return; }
      if (!r || !ROLURI[r.role]) { setAcces({ stare: "fara-rol" }); return; }
      setAcces({ stare: "ok", rol: r.role, factorId: factor?.id || null, mfaActiv: !!factor });
    } catch (e) {
      setAcces({ stare: "eroare", mesaj: String(e?.message || e) });
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) setSession(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const userId = session === undefined ? undefined : session?.user?.id || null;
  useEffect(() => {
    if (!supabaseConfigured || session === undefined) return;
    if (!session) { setAcces({ stare: "login" }); return; }
    setAcces({ stare: "verific" });
    evalueaza(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const reevalueaza = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setAcces({ stare: "verific" });
    await evalueaza(data.session);
  }, [evalueaza]);

  const signIn = useCallback(async (email, parola) => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: parola });
    if (error) {
      setAuthError(error.message === "Invalid login credentials" ? "Email sau parolă greșite." : error.message);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  return { session, authError, signIn, signOut, acces, reevalueaza };
}

function useIdleLock(activ, minute, onLock) {
  const last = useRef(Date.now());
  const cb = useRef(onLock);
  cb.current = onLock;
  useEffect(() => {
    if (!activ) return;
    last.current = Date.now();
    const touch = () => { last.current = Date.now(); };
    const evs = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel", "click"];
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const check = () => { if (Date.now() - last.current > minute * 60000) cb.current(); };
    const iv = setInterval(check, 10000);
    const vis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(iv);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [activ, minute]);
}

function LoginScreen({ onSignIn, error }) {
  const [email, setEmail] = useState("");
  const [parola, setParola] = useState("");
  const [loading, setLoading] = useState(false);
  const [esecuri, setEsecuri] = useState(0);
  const [blocatPana, setBlocatPana] = useState(0);
  const [acum, setAcum] = useState(Date.now());

  useEffect(() => {
    if (!blocatPana) return;
    const iv = setInterval(() => setAcum(Date.now()), 500);
    return () => clearInterval(iv);
  }, [blocatPana]);
  const secRamase = Math.max(0, Math.ceil((blocatPana - acum) / 1000));

  async function submit(e) {
    e.preventDefault();
    if (secRamase > 0) return;
    setLoading(true);
    const ok = await onSignIn(email.trim(), parola);
    setLoading(false);
    if (!ok) {
      const n = esecuri + 1;
      setEsecuri(n);
      setParola("");
      if (n >= 5) {
        const pauza = Math.min(15 * 60, 30 * Math.pow(2, n - 5)); // 30s, 60s, 120s ... max 15 min
        setBlocatPana(Date.now() + pauza * 1000);
        setAcum(Date.now());
      }
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit} autoComplete="on">
        <div className="login-brand">
          <div className="brand-mark">NP</div>
          <div>
            <div className="brand-name">NOVATECH</div>
            <div className="brand-sub">PROIECT SRL</div>
          </div>
        </div>
        <h2>Autentificare</h2>
        <Field label="Email"><input type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@novatechproiect.ro" /></Field>
        <Field label="Parolă"><input type="password" name="password" autoComplete="current-password" required value={parola} onChange={(e) => setParola(e.target.value)} placeholder="••••••••" /></Field>
        {error && <div className="login-error"><IconAlert size={15} /> {error}</div>}
        {secRamase > 0 && <div className="login-error"><IconAlert size={15} /> Prea multe încercări greșite. Mai așteaptă {secRamase} secunde.</div>}
        <Button type="submit" disabled={loading || secRamase > 0} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Se conectează…" : "Intră în cont"}</Button>
      </form>
    </div>
  );
}

function CodInput({ value, onChange }) {
  return (
    <input
      inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus autoComplete="one-time-code"
      value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="123456" style={{ letterSpacing: 6, fontSize: 20, textAlign: "center" }}
    />
  );
}

async function verificaCodTotp(factorId, cod) {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error) return ch.error.message;
  const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: cod });
  return v.error ? "Cod greșit sau expirat. Încearcă din nou cu codul curent din aplicație." : null;
}

function MfaChallenge({ factorId, onDone, onSignOut }) {
  const [cod, setCod] = useState("");
  const [eroare, setEroare] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setLoading(true); setEroare("");
    const err = await verificaCodTotp(factorId, cod);
    setLoading(false);
    if (err) { setEroare(err); setCod(""); } else onDone();
  }
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h2>Verificare în doi pași</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Deschide aplicația de autentificare din telefon (Google Authenticator, Microsoft Authenticator etc.) și introdu codul de 6 cifre pentru Novatech.</p>
        <Field label="Cod de 6 cifre"><CodInput value={cod} onChange={setCod} /></Field>
        {eroare && <div className="login-error"><IconAlert size={15} /> {eroare}</div>}
        <Button type="submit" disabled={loading || cod.length !== 6} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Se verifică…" : "Confirmă"}</Button>
        <div style={{ marginTop: 12, textAlign: "center" }}><button type="button" className="link-btn muted" onClick={onSignOut}>Deconectare</button></div>
      </form>
    </div>
  );
}

function BlocajAcces({ stare, mesaj, onSignOut }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h2>{stare === "fara-rol" ? "Cont fără acces" : "Nu s-a putut verifica accesul"}</h2>
        {stare === "fara-rol"
          ? <p style={{ fontSize: 13.5 }}>Contul tău este creat, dar nu are un rol atribuit în aplicație. Cere administratorului să îți acorde acces.</p>
          : <p style={{ fontSize: 13.5 }}>Verificarea rolului a eșuat{mesaj ? `: ${mesaj}` : "."} Dacă tocmai ai actualizat aplicația, administratorul trebuie să ruleze scriptul de securitate în Supabase (vezi instrucțiunile primite).</p>}
        <Button variant="ghost" onClick={onSignOut} style={{ width: "100%", justifyContent: "center" }}>Deconectare</Button>
      </div>
    </div>
  );
}

function EroareIncarcare({ eroare, onSignOut }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h2>Datele nu s-au putut încărca</h2>
        <p style={{ fontSize: 13.5 }}>Din siguranță, aplicația nu afișează și nu salvează nimic până nu poate citi corect datele. {eroare ? `Detalii: ${eroare}` : ""}</p>
        <Button onClick={() => window.location.reload()} style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}>Reîncearcă</Button>
        <Button variant="ghost" onClick={onSignOut} style={{ width: "100%", justifyContent: "center" }}>Deconectare</Button>
      </div>
    </div>
  );
}

function LockScreen({ email, factorId, onUnlock, onSignOut }) {
  const [valoare, setValoare] = useState("");
  const [eroare, setEroare] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setLoading(true); setEroare("");
    let err = null;
    if (factorId) err = await verificaCodTotp(factorId, valoare);
    else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: valoare });
      if (error) err = "Parolă greșită.";
    }
    setLoading(false);
    if (err) { setEroare(err); setValoare(""); } else onUnlock();
  }
  return (
    <div className="login-screen" style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      <form className="login-card" onSubmit={submit}>
        <h2>Aplicație blocată</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Sesiunea a fost blocată după {MINUTE_BLOCARE} minute fără activitate. {email}</p>
        {factorId
          ? <Field label="Cod de 6 cifre din aplicația de autentificare"><CodInput value={valoare} onChange={setValoare} /></Field>
          : <Field label="Parolă"><input type="password" autoFocus required value={valoare} onChange={(e) => setValoare(e.target.value)} placeholder="••••••••" /></Field>}
        {eroare && <div className="login-error"><IconAlert size={15} /> {eroare}</div>}
        <Button type="submit" disabled={loading || !valoare || (factorId && valoare.length !== 6)} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Se verifică…" : "Deblochează"}</Button>
        <div style={{ marginTop: 12, textAlign: "center" }}><button type="button" className="link-btn muted" onClick={onSignOut}>Deconectare</button></div>
      </form>
    </div>
  );
}

/* ---------------------------- Utilitare ---------------------------- */

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2, 11));

const ron = (n) => {
  const v = Number(n) || 0;
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 }).format(v);
};

const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return "—";
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

const daysUntil = (s) => {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return null;
  return Math.round((d - new Date(TODAY.toDateString())) / 86400000);
};

const urgency = (s) => {
  const d = daysUntil(s);
  if (d === null) return null;
  if (d < 0) return "danger";
  if (d <= 14) return "danger";
  if (d <= 45) return "warn";
  return "ok";
};

const monthKey = (s) => (s || "").slice(0, 7);
const currentMonthKey = TODAY.toISOString().slice(0, 7);

/* ---------------------------- Sărbători legale (calendar RO) ---------------------------- */
// Paștele ortodox (algoritmul Meeus, calendar iulian -> gregorian), folosit pentru
// sărbătorile mobile din Codul Muncii (Vinerea Mare, Paște, Rusalii).
function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  // conversie iulian -> gregorian: se adaugă 13 zile (valabil sec. XX-XXI)
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}
const addDays = (date, n) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; };
const toISO = (d) => d.toISOString().slice(0, 10);

function romanianHolidays(year) {
  const easter = orthodoxEaster(year);
  const fixed = [
    `${year}-01-01`, `${year}-01-02`, `${year}-01-06`, `${year}-01-07`, `${year}-01-24`,
    `${year}-05-01`, `${year}-06-01`, `${year}-08-15`, `${year}-11-30`, `${year}-12-01`,
    `${year}-12-25`, `${year}-12-26`,
  ];
  const movable = [
    toISO(addDays(easter, -2)),  // Vinerea Mare
    toISO(easter),               // Paște
    toISO(addDays(easter, 1)),   // a doua zi de Paște
    toISO(addDays(easter, 49)),  // Rusalii
    toISO(addDays(easter, 50)),  // a doua zi de Rusalii
  ];
  return new Set([...fixed, ...movable]);
}

/** Numărul de zile lucrătoare între două date (inclusiv), excluzând weekendurile
 *  și sărbătorile legale românești din anul/anii acoperiți (GP-03c). */
function calcZileLucratoare(startStr, finalStr) {
  const start = new Date(startStr + "T00:00:00");
  const final = new Date(finalStr + "T00:00:00");
  if (isNaN(start) || isNaN(final) || final < start) return 0;
  const holidaySets = {};
  let count = 0;
  for (let d = new Date(start); d <= final; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    if (!holidaySets[y]) holidaySets[y] = romanianHolidays(y);
    const dow = d.getDay(); // 0=duminica, 6=sambata
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySets[y].has(iso)) count++;
  }
  return count;
}

/** Zile calendaristice simple (folosite pentru concediul medical, care acoperă
 *  perioada certificatului, inclusiv weekend). */
function calcZileCalendaristice(startStr, finalStr) {
  const start = new Date(startStr + "T00:00:00");
  const final = new Date(finalStr + "T00:00:00");
  if (isNaN(start) || isNaN(final) || final < start) return 0;
  return Math.round((final - start) / 86400000) + 1;
}

/** Generează și descarcă documentul de decizie (aprobare/respingere concediu) — GP-03e. */
function descarcaDecizieConcediu(angajat, cerere) {
  const decizieText = cerere.status === "Avizat" ? "APROBAT" : "RESPINS";
  const tipText = cerere.tip === "Medical" ? "concediu medical" : "concediu de odihnă";
  const certLine = cerere.tip === "Medical" && cerere.nrCertificatMedical ? `<p><strong>Nr. certificat medical:</strong> ${cerere.nrCertificatMedical}</p>` : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Decizie concediu</title><style>
body{font-family:Georgia,serif;max-width:700px;margin:40px auto;color:#16232E;line-height:1.6}
h1{font-size:18px;text-transform:uppercase;text-align:center;margin-top:40px}
.header{text-align:center;font-size:13px;color:#444;border-bottom:2px solid #123A5C;padding-bottom:10px;margin-bottom:20px}
.decizie{font-weight:bold;font-size:15px;margin:24px 0}
.semnaturi{display:flex;justify-content:space-between;margin-top:60px}
@media print{ body{margin:0} }
</style></head><body>
<div class="header"><strong>NOVATECH PROIECT SRL</strong><br>Str. Pajurei 17, bl H3, sc C, ap 50 · office@novatechproiect.ro</div>
<h1>Decizie privind cererea de concediu</h1>
<p><strong>Angajat:</strong> ${angajat?.nume || "—"}</p>
<p><strong>Funcție:</strong> ${angajat?.rol || "—"}</p>
<p><strong>Tip concediu:</strong> ${tipText}</p>
${certLine}
<p><strong>Perioada solicitată:</strong> ${fmtDate(cerere.dataStart)} – ${fmtDate(cerere.dataFinal)}</p>
<p><strong>Număr de zile:</strong> ${cerere.nrZile}</p>
<p class="decizie">Decizie: cererea de mai sus este ${decizieText}.</p>
<p><strong>Data emiterii:</strong> ${fmtDate(new Date().toISOString().slice(0, 10))}</p>
<div class="semnaturi"><div>Semnătura conducerii<br><br>______________________</div><div>Semnătura angajatului<br><br>______________________</div></div>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* ---------------------------- Deviz: categorii de linii ---------------------------- */
const CATEGORII_DEVIZ = ["Instalații/echipamente", "Materiale consumabile", "Manoperă"];

/* =========================================================================
   TARIFE CONTRACTE — liste de prețuri din contractele-cadru (pentru devize și facturare)
   Sursă: Kaufland, Contract-cadru nr. 6562/09.04.2025, Anexa 02 (Lista de prețuri), ventilație.
   Serviciile sunt în RON, piesele (filtre) în EUR, toate fără TVA.
   Climatizare/service: Contract nr. 6548/03.04.2025 (Anexa 02). Un contract nou se adaugă ca încă un obiect în lista de mai jos.
   ========================================================================= */
const TARIFE_CONTRACTE = []; // se umple din baza de date (cheia tarifeContracte) — prețurile din contracte nu stau în codul public

const fmtPret = (n, moneda) =>
  new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + (moneda === "EUR" ? " €" : " lei");
const MOMENTE_DEVIZ = ["Inițial (ofertă)", "Suplimentar", "Final"];

function totalLinie(l) { return (Number(l.cantitate) || 0) * (Number(l.pretUnitar) || 0); }
function totalDeviz(deviz) { return (deviz.linii || []).reduce((s, l) => s + totalLinie(l), 0); }
function totalToateDevizele(proiect) { return (proiect.devize || []).reduce((s, d) => s + totalDeviz(d), 0); }

/* ---------------------------- Salarizare: cost/zi și cost/oră (GP-13) ---------------------------- */
function costZiSalariu(s) { return s.zileLucrate ? (Number(s.cost) || 0) / s.zileLucrate : 0; }
function costOraSalariu(s) { return costZiSalariu(s) / 8; }

function saptamanaCurenta() {
  const azi = new Date(); azi.setHours(0, 0, 0, 0);
  const ziSaptamana = azi.getDay();
  const offsetLuni = ziSaptamana === 0 ? -6 : 1 - ziSaptamana;
  const luni = new Date(azi); luni.setDate(azi.getDate() + offsetLuni);
  const zile = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(luni); d.setDate(luni.getDate() + i);
    zile.push(d.toISOString().slice(0, 10));
  }
  return zile;
}

/* ---------------------------- Cash-Flow: totaluri săptămânale ---------------------------- */
const CATEGORII_CHELTUIELI_FIXE = [
  ["chirii", "Chirii (birou/depozit)"], ["utilitati", "Utilități"], ["asigurari", "Asigurare firmă"],
  ["administrative", "Cheltuieli administrative"], ["marketing", "Marketing"], ["contabilitate", "Contabilitate"],
  ["telefonieInternet", "Telefonie/Internet"], ["salarii", "Salarii"], ["taxe", "Taxe (CAS/CASS/CAM/TVA/trimestriale)"],
  ["bonuriMasa", "Bonuri de masă"], ["abonamenteSoftware", "Abonamente software/GPS"],
  ["medicinaMuncii", "Medicina muncii"], ["ssm", "SSM"], ["onrc", "ONRC/autorizații"],
];
const CATEGORII_CHELTUIELI_VARIABILE = [
  ["mentenantaReparatii", "Mentenanță și reparații"], ["dobanziTaxeBancare", "Dobânzi și taxe bancare"], ["calatoriiAfaceri", "Călătorii de afaceri"],
];
function totalVenituriSaptamana(s) {
  const v = s.venituri || {};
  return (Number(v.echipamente) || 0) + (Number(v.produseMateriale) || 0) + (Number(v.servicii) || 0) + (Number(v.alteSurse) || 0);
}
function totalCheltuieliAutoLunar(active) {
  return active.filter((a) => a.tip === "vehicul").reduce((s, a) => s + (Number(a.costLunarMediu) || 0), 0);
}
function totalCheltuieliFixeSaptamana(s, active) {
  const c = s.cheltuieli || {};
  return CATEGORII_CHELTUIELI_FIXE.reduce((sum, cat) => sum + (Number(c[cat[0]]) || 0), 0) + totalCheltuieliAutoLunar(active) / 4.33;
}
function totalCheltuieliVariabileSaptamana(s) {
  const c = s.cheltuieli || {};
  return CATEGORII_CHELTUIELI_VARIABILE.reduce((sum, cat) => sum + (Number(c[cat[0]]) || 0), 0);
}
function soldCashSaptamana(s, active) { return totalVenituriSaptamana(s) - totalCheltuieliFixeSaptamana(s, active) - totalCheltuieliVariabileSaptamana(s); }

/* ---------------------------- Date seed ---------------------------- */

// Datele reale NU mai sunt în cod (codul este public). Ele trăiesc doar în baza de date.
function seedData() { return DATE_VIDE(); }

/* ---------------------------- Iconițe (linie subțire, stil tehnic) ---------------------------- */

const Icon = ({ path, size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {path}
  </svg>
);
const IconDash = (p) => <Icon {...p} path={<><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></>} />;
const IconWorks = (p) => <Icon {...p} path={<><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/><path d="M9 12h.01M15 12h.01"/></>} />;
const IconUsers = (p) => <Icon {...p} path={<><circle cx="9" cy="8" r="3"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><circle cx="18" cy="8" r="2.4"/><path d="M16 14.2c2.7.4 5 2.6 5 6.8"/></>} />;
const IconClients = (p) => <Icon {...p} path={<><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 8.5 18 10l3.5-3.5"/></>} />;
const IconMoney = (p) => <Icon {...p} path={<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v.01M18 14v.01"/></>} />;
const IconTruck = (p) => <Icon {...p} path={<><rect x="1" y="7" width="14" height="10" rx="1"/><path d="M15 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="18" cy="19" r="1.6"/></>} />;
const IconPlus = (p) => <Icon {...p} path={<><path d="M12 5v14M5 12h14"/></>} />;
const IconX = (p) => <Icon {...p} path={<><path d="M18 6 6 18M6 6l12 12"/></>} />;
const IconEdit = (p) => <Icon {...p} path={<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></>} />;
const IconTrash = (p) => <Icon {...p} path={<><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></>} />;
const IconAlert = (p) => <Icon {...p} path={<><path d="M12 3 1 21h22Z"/><path d="M12 9v5M12 17h.01"/></>} />;
const IconLock = (p) => <Icon {...p} path={<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></>} />;
const IconCalendar = (p) => <Icon {...p} path={<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h4M7 17.5h7"/></>} />;
const IconCheck = (p) => <Icon {...p} path={<><path d="M20 6 9 17l-5-5"/></>} />;
const IconClock = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />;
const IconWinMin = (p) => <Icon {...p} path={<><path d="M5 12h14"/></>} />;
const IconWinMax = (p) => <Icon {...p} path={<><rect x="5" y="5" width="14" height="14" rx="1"/></>} />;
const IconWinRestore = (p) => <Icon {...p} path={<><rect x="7" y="3" width="11" height="11" rx="1"/><rect x="3" y="7" width="11" height="11" rx="1"/></>} />;
const IconCashflow = (p) => <Icon {...p} path={<><path d="M3 12h18"/><path d="M7 7l-4 5 4 5"/><path d="M17 7l4 5-4 5"/></>} />;
const IconAI = (p) => <Icon {...p} path={<><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></>} />;
const IconGantt = (p) => <Icon {...p} path={<><rect x="3" y="4" width="8" height="3" rx="1"/><rect x="7" y="10.5" width="10" height="3" rx="1"/><rect x="5" y="17" width="14" height="3" rx="1"/></>} />;
const IconDoc = (p) => <Icon {...p} path={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>} />;
const IconMenu = (p) => <Icon {...p} path={<><path d="M3 6h18M3 12h18M3 18h18"/></>} />;
const IconCalc = (p) => <Icon {...p} path={<><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/></>} />;

/* ---------------------------- Situație financiară istorică (din balanțele de verificare 2022-2024) ---------------------------- */
// Cifre agregate din conturile contabile reale (clasele 1,2,4,5,6,7), preluate din
// "Balanta de verificare decembrie {an}.xls" — solduri finale pt. bilanț, sume totale
// anuale (cumulate) pt. contul de rezultate. Balanța 2025 nu era disponibilă la
// generarea acestor cifre; se poate actualiza prin re-import.
const ISTORIC_FINANCIAR = []; // se umple din baza de date (cheia istoricFinanciar)
function ultimulAnFinanciar() { return ISTORIC_FINANCIAR[ISTORIC_FINANCIAR.length - 1] || { an: 0, cifraAfaceri: 0, totalVenituri: 0, totalCheltuieli: 0, profitNet: 0, capitaluriProprii: 0, activeImobilizateNete: 0, creante: 0, trezorerie: 0, datoriiTermenLung: 0, datoriiCurente: 0 }; }

/* ---------------------------- Context date ---------------------------- */

const DataCtx = createContext(null);
const useData = () => useContext(DataCtx);

/* ---------------------------- Roluri și niveluri de acces la date ---------------------------- */
// Datele sunt împărțite pe 3 niveluri, păstrate în rânduri separate în baza de date.
// Serverul (Supabase, prin RLS) este cel care decide cine citește fiecare nivel;
// ascunderea din meniu este doar confort, nu protecție.
//   nivel 1 — operațional: toate rolurile
//   nivel 2 — birou: administrator + birou
//   nivel 3 — confidențial: doar administrator (salarii, cash-flow, ANAF, situații istorice)
const ROLURI = { admin: "Administrator", birou: "Birou", tehnician: "Tehnician" };
const CHEI_OP = ["clienti", "proiecte", "concedii", "pontaje", "tichete", "garantii", "active", "materialeStoc", "setari"];
const CHEI_BIROU = ["angajati", "facturi", "furnizori", "miscariPartener", "cheltuieliAdm", "achizitiiPlanificate", "tarifeContracte"];
const NIVELE_ROL = { admin: [1, 2, 3], birou: [1, 2], tehnician: [1] };
const NAV_ROL = {
  admin: ["dashboard", "lucrari", "calendar", "personal", "clienti", "financiar", "patrimoniu", "cashflow", "calculator", "securitate"],
  birou: ["dashboard", "lucrari", "calendar", "clienti", "financiar", "patrimoniu", "calculator", "securitate"],
  tehnician: ["lucrari", "calendar", "clienti", "securitate"],
};
const nivelCheie = (k) => (CHEI_OP.includes(k) ? 1 : CHEI_BIROU.includes(k) ? 2 : 3);
const DATE_VIDE = () => ({
  clienti: [], proiecte: [], concedii: [], pontaje: [], tichete: [], garantii: [], active: [], materialeStoc: [], setari: {},
  angajati: [], facturi: [], furnizori: [], miscariPartener: [], cheltuieliAdm: [], achizitiiPlanificate: [], tarifeContracte: [],
  salarii: [], cashflow: [], obligatiiFiscale: [], datoriiAnaf: [], istoricFinanciar: [],
});
function partitie(d, id) {
  const o = {};
  Object.keys(d || {}).forEach((k) => { if (nivelCheie(k) === id) o[k] = d[k]; });
  return o;
}
// serializare cu chei sortate — Postgres (jsonb) reordonează cheile, deci comparăm forma canonică
function stable(v) {
  return JSON.stringify(v, (k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.keys(val).sort().reduce((o, kk) => { o[kk] = val[kk]; return o; }, {})
      : val
  );
}
// datele de referință (bilanțuri istorice, tarife contracte) nu mai sunt în codul public, ci vin din baza de date
function aplicaConstante(d) {
  ISTORIC_FINANCIAR.length = 0;
  ISTORIC_FINANCIAR.push(...((d && d.istoricFinanciar) || []));
  TARIFE_CONTRACTE.length = 0;
  TARIFE_CONTRACTE.push(...((d && d.tarifeContracte) || []));
}

/* ---------------------------- Hook stocare persistentă ---------------------------- */

function usePersistentData(rol) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | saving | error
  const [eroare, setEroare] = useState("");
  const incarcat = useRef(false);
  const skipLocal = useRef(true);
  const saveTimer = useRef(null);
  const rowsJson = useRef({}); // id rând -> ultima formă canonică știută în baza de date
  const nivele = NIVELE_ROL[rol] || [];
  const acum = () => new Date().toISOString();

  useEffect(() => {
    incarcat.current = false;
    skipLocal.current = true;
    if (!rol) { setData(null); aplicaConstante({}); return; }
    let cancelled = false;
    (async () => {
      setStatus("loading"); setEroare("");
      try {
        let full;
        if (supabaseConfigured) {
          let rows = {};
          for (const id of nivele) {
            const { data: row, error } = await supabase.from("app_state").select("data").eq("id", id).maybeSingle();
            if (error) throw error;
            rows[id] = row ? row.data : null;
          }
          if (cancelled) return;
          const legacy = rows[1] || {};
          const straine = Object.keys(legacy).filter((k) => nivelCheie(k) !== 1);
          if (straine.length) {
            if (rol !== "admin") {
              throw new Error("Datele nu au fost încă reorganizate pe niveluri de acces. Conectează-te mai întâi ca administrator.");
            }
            // migrare unică: datele vechi (un singur document) se împart pe niveluri; copia veche se păstrează în backup
            const bk = await supabase.from("app_state_backup").insert({ row_id: 1, data: legacy, saved_by: "migrare-niveluri" });
            if (bk.error) throw bk.error;
            const noi = { 1: partitie(legacy, 1), 2: { ...partitie(legacy, 2), ...(rows[2] || {}) }, 3: { ...partitie(legacy, 3), ...(rows[3] || {}) } };
            for (const id of [2, 3, 1]) {
              const { error } = await supabase.from("app_state").upsert({ id, data: noi[id], updated_at: acum() }, { onConflict: "id" });
              if (error) throw error;
            }
            rows = noi;
          }
          full = DATE_VIDE();
          nivele.forEach((id) => {
            const part = partitie(rows[id] || {}, id);
            Object.assign(full, part);
            rowsJson.current[id] = stable(part);
          });
        } else {
          const res = await window.storage.get(STORAGE_KEY, true);
          if (cancelled) return;
          full = { ...DATE_VIDE(), ...(res && res.value ? JSON.parse(res.value) : {}) };
        }
        aplicaConstante(full);
        incarcat.current = true;
        setData(full);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        // niciodată nu se pornește cu date goale peste cele reale: fără citire reușită, nu se afișează și nu se salvează nimic
        setData(null);
        setEroare(String(e?.message || e));
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [rol]);

  // sincronizare live: când alt dispozitiv salvează, primim update-ul automat (doar nivelurile la care avem acces)
  useEffect(() => {
    if (!supabaseConfigured || !rol) return;
    const channel = supabase
      .channel("app_state_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_state" }, (payload) => {
        const row = payload.new;
        if (!row || !nivele.includes(row.id) || !incarcat.current) return;
        const part = partitie(row.data, row.id);
        const sj = stable(part);
        if (sj === rowsJson.current[row.id]) return; // e propria noastră scriere
        rowsJson.current[row.id] = sj;
        setData((prev) => {
          if (!prev) return prev;
          const n = { ...prev, ...part };
          aplicaConstante(n);
          return n;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rol]);

  useEffect(() => {
    if (data === null || !incarcat.current) return;
    if (!supabaseConfigured) {
      if (skipLocal.current) { skipLocal.current = false; return; }
      setStatus("saving");
      saveTimer.current = setTimeout(async () => {
        try { await window.storage.set(STORAGE_KEY, JSON.stringify(data), true); setStatus("ready"); } catch (e) { setStatus("error"); }
      }, 500);
      return () => clearTimeout(saveTimer.current);
    }
    const schimbate = nivele.filter((id) => stable(partitie(data, id)) !== rowsJson.current[id]);
    if (!schimbate.length) return;
    setStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        for (const id of schimbate) {
          const part = partitie(data, id);
          const { error } = await supabase.from("app_state").upsert({ id, data: part, updated_at: acum() }, { onConflict: "id" });
          if (error) throw error;
          rowsJson.current[id] = stable(part);
        }
        setStatus("ready");
      } catch (e) {
        setStatus("error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  const update = useCallback((fn) => setData((prev) => fn(structuredClone(prev))), []);

  // doar în modul local (demo): golește datele. Cu baza de date reală, ștergerea totală nu mai e posibilă din aplicație.
  const reset = useCallback(async () => {
    if (supabaseConfigured) return;
    const fresh = DATE_VIDE();
    setData(fresh);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(fresh), true); } catch (e) {}
  }, []);

  // import/restaurare dintr-o copie de siguranță: înlocuiește doar cheile prezente în fișier și permise rolului curent
  const inlocuieste = useCallback((obj) => {
    const model = DATE_VIDE();
    const aplicate = [], ignorate = [];
    const bune = {};
    Object.keys(obj || {}).forEach((k) => {
      const ok = k in model && nivele.includes(nivelCheie(k)) && Array.isArray(obj[k]) === Array.isArray(model[k]) && typeof obj[k] === typeof model[k] && obj[k] !== null;
      if (ok) { bune[k] = obj[k]; aplicate.push(k); } else ignorate.push(k);
    });
    if (aplicate.length) setData((prev) => { const n = { ...prev, ...bune }; aplicaConstante(n); return n; });
    return { aplicate, ignorate };
  }, [rol]);

  return { data, status, eroare, update, reset, rol, inlocuieste };
}

/* ---------------------------- Componente UI reutilizabile ---------------------------- */

function Badge({ tone = "neutral", children }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

function UrgencyBadge({ date, labelOk = "OK" }) {
  if (!date) return <span className="muted">—</span>;
  const u = urgency(date);
  const d = daysUntil(date);
  const label = d < 0 ? `Expirat de ${Math.abs(d)} zile` : `${fmtDate(date)} (${d} zile)`;
  return <Badge tone={u === "danger" ? "danger" : u === "warn" ? "warn" : "ok"}>{u === "ok" ? fmtDate(date) : label}</Badge>;
}

function Card({ children, className = "", title, action }) {
  return (
    <div className={`card ${className}`}>
      <span className="bracket bracket-tl" /><span className="bracket bracket-br" />
      {title && (
        <div className="card-head">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Button({ variant = "primary", size = "md", children, ...props }) {
  return <button className={`btn btn-${variant} btn-${size}`} {...props}>{children}</button>;
}

function IconButton({ children, title, className, ...props }) {
  return <button className={`icon-btn ${className || ""}`} title={title} {...props}>{children}</button>;
}

function Field({ label, children, hint, wide }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => { if (!open) { setMinimized(false); setMaximized(false); } }, [open]);
  if (!open) return null;
  const panelClass = `modal-panel ${wide ? "wide" : ""} ${maximized ? "maximized" : ""} ${minimized ? "minimized" : ""}`;
  return (
    <div className={`modal-overlay ${minimized ? "overlay-minimized" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={panelClass}>
        <div className="modal-head" onClick={() => { if (minimized) setMinimized(false); }}>
          <h3>{title}</h3>
          <div className="win-controls">
            <IconButton className="win-btn" onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m); setMaximized(false); }} title="Minimizează"><IconWinMin size={13} /></IconButton>
            <IconButton className="win-btn" onClick={(e) => { e.stopPropagation(); setMaximized((m) => !m); setMinimized(false); }} title={maximized ? "Restaurează" : "Maximizează"}>{maximized ? <IconWinRestore size={13} /> : <IconWinMax size={12} />}</IconButton>
            <IconButton className="win-btn win-close" onClick={(e) => { e.stopPropagation(); onClose(); }} title="Închide"><IconX size={16} /></IconButton>
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function ConfirmDelete({ onConfirm, title = "Ștergi această înregistrare?" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <IconButton title="Șterge" onClick={() => setOpen(true)}><IconTrash size={15} /></IconButton>;
  }
  return (
    <span className="confirm-inline">
      <span>{title}</span>
      <button className="link-btn danger" onClick={() => { onConfirm(); setOpen(false); }}>Da, șterge</button>
      <button className="link-btn" onClick={() => setOpen(false)}>Anulează</button>
    </span>
  );
}

/* Toast */
const ToastCtx = createContext(() => {});
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, tone = "ok") => {
    const id = uid();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => <div key={t.id} className={`toast tone-${t.tone}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

/* =========================================================================
   MODULE: TABLOU DE BORD
   ========================================================================= */

function Dashboard() {
  const { data } = useData();

  const proiecteActive = data.proiecte.filter((p) => p.stadiu === "Execuție" || p.stadiu === "Contract");
  const marjaTotala = data.proiecte.reduce((s, p) => {
    const val = p.valoareContract ?? p.valoareOferta ?? 0;
    return s + (val - (p.costRealizat || 0));
  }, 0);

  const tvaColectat = data.facturi.filter((f) => f.tip === "emisa" && monthKey(f.data) === currentMonthKey)
    .reduce((s, f) => s + (f.valoareFaraTva * f.cotaTva) / 100, 0);
  const tvaDeductibil = data.facturi.filter((f) => f.tip === "primita" && monthKey(f.data) === currentMonthKey)
    .reduce((s, f) => s + (f.valoareFaraTva * f.cotaTva) / 100, 0);
  const soldTva = tvaColectat - tvaDeductibil;

  const alerts = [];
  data.angajati.forEach((a) => a.certificari.forEach((c) => {
    const u = urgency(c.dataExpirare);
    if (u === "danger" || u === "warn") alerts.push({ tip: "Certificare", text: `${c.nume} — ${a.nume}`, date: c.dataExpirare, u });
  }));
  data.angajati.forEach((a) => {
    if (a.medicinaMuncii?.dataExpirare) {
      const u = urgency(a.medicinaMuncii.dataExpirare);
      if (u === "danger" || u === "warn") alerts.push({ tip: "Medicina muncii", text: a.nume, date: a.medicinaMuncii.dataExpirare, u });
    }
  });
  data.active.forEach((a) => {
    [["ITP", a.itpExpira], ["RCA", a.rcaExpira], ["Revizie", a.revizieExpira]].forEach(([label, d]) => {
      const u = urgency(d);
      if (u === "danger" || u === "warn") alerts.push({ tip: label, text: a.denumire, date: d, u });
    });
  });
  data.garantii.forEach((g) => {
    const u = urgency(g.dataExpirare);
    if (u === "danger" || u === "warn") alerts.push({ tip: "Garanție", text: g.termeni, date: g.dataExpirare, u });
  });
  const cereriInAsteptare = data.concedii.filter((c) => c.status === "Cerere").length;
  const facturiNeinregistrate = data.facturi.filter((f) => f.tip === "primita" && f.status === "Neînregistrată").length;

  alerts.sort((a, b) => daysUntil(a.date) - daysUntil(b.date));

  const maxVal = Math.max(1, ...data.proiecte.map((p) => (p.valoareContract ?? p.valoareOferta ?? 0)));

  return (
    <div className="stack-lg">
      <div className="grid-4">
        <Card>
          <div className="kpi-label">Proiecte active</div>
          <div className="kpi-value">{proiecteActive.length}</div>
          <div className="kpi-sub">din {data.proiecte.length} proiecte în evidență</div>
        </Card>
        <Card>
          <div className="kpi-label">Marjă estimată — portofoliu</div>
          <div className="kpi-value mono">{ron(marjaTotala)}</div>
          <div className="kpi-sub">contract/ofertă minus cost realizat</div>
        </Card>
        <Card>
          <div className="kpi-label">Sold TVA — luna curentă</div>
          <div className={`kpi-value mono ${soldTva >= 0 ? "text-danger" : "text-ok"}`}>{ron(Math.abs(soldTva))}</div>
          <div className="kpi-sub">{soldTva >= 0 ? "de plată către stat" : "de recuperat"}</div>
        </Card>
        <Card>
          <div className="kpi-label">Alerte active</div>
          <div className="kpi-value">{alerts.length}</div>
          <div className="kpi-sub">{cereriInAsteptare} cereri concediu · {facturiNeinregistrate} facturi neînregistrate</div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Profitabilitate estimată pe proiect">
          <div className="stack-md">
            {data.proiecte.map((p) => {
              const val = p.valoareContract ?? p.valoareOferta ?? 0;
              const marja = val - (p.costRealizat || 0);
              const pct = Math.max(4, Math.round((val / maxVal) * 100));
              const pctCost = val ? Math.min(100, Math.round(((p.costRealizat || 0) / val) * 100)) : 0;
              return (
                <div className="bar-row" key={p.id}>
                  <div className="bar-row-head">
                    <span>{p.nume}</span>
                    <span className={`mono ${marja < 0 ? "text-danger" : "text-ok"}`}>{ron(marja)}</span>
                  </div>
                  <div className="bar-track" style={{ width: pct + "%" }}>
                    <div className="bar-fill" style={{ width: pctCost + "%" }} />
                  </div>
                  <div className="cell-sub mono" style={{ marginTop: 2 }}>{pctCost}% din valoare consumat ca și cost</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Alerte de urmărit">
          {alerts.length === 0 ? <EmptyState text="Nicio alertă activă în acest moment." /> : (
            <ul className="alert-list">
              {alerts.map((a, i) => (
                <li key={i}>
                  <IconAlert size={15} className={a.u === "danger" ? "text-danger" : "text-warn"} />
                  <span className="alert-tip">{a.tip}</span>
                  <span className="alert-text">{a.text}</span>
                  <UrgencyBadge date={a.date} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Programare săptămâna curentă (din activitățile Gantt)">
        <ProgramareSaptamanala data={data} />
      </Card>
    </div>
  );
}

function ProgramareSaptamanala({ data }) {
  const zile = saptamanaCurenta();
  const numeZile = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];
  const azi = new Date().toISOString().slice(0, 10);
  const angajatiActivi = data.angajati.filter((a) => a.activ !== false);

  function programare(angajatId, ziStr) {
    for (const p of data.proiecte) {
      for (const act of p.activitatiGantt || []) {
        if (act.angajatId === angajatId && act.dataStart && act.dataFinal && ziStr >= act.dataStart && ziStr <= act.dataFinal) {
          return { proiect: p.nume, activitate: act.denumire };
        }
      }
    }
    return null;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Angajat</th>
          {zile.map((z, i) => (
            <th key={z} className={z === azi ? "text-ok" : ""}>{numeZile[i]}<br /><span className="mono cell-sub">{fmtDate(z)}</span></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {angajatiActivi.length === 0 ? <tr><td colSpan={8}><EmptyState text="Niciun angajat activ." /></td></tr> : angajatiActivi.map((a) => (
          <tr key={a.id}>
            <td className="cell-title">{a.nume}</td>
            {zile.map((z) => {
              const prog = programare(a.id, z);
              return (
                <td key={z} style={{ textAlign: prog ? "left" : "center" }}>
                  {prog ? (
                    <>
                      <div className="cell-title" style={{ fontSize: 11.5 }}>{prog.proiect.split(" — ")[0]}</div>
                      <div className="cell-sub" style={{ fontSize: 10.5 }}>{prog.activitate}</div>
                    </>
                  ) : <span className="muted">—</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* =========================================================================
   MODULE: GESTIUNE LUCRĂRI
   ========================================================================= */

const STADII = ["Ofertare", "Contract", "Execuție", "Finalizat"];
const CATEGORII_PROIECT = ["Kaufland", "Nibe", "E.ON", "Lucrări diverse"];
// "Strust Eurotherm" a fost redenumit "Nibe". Valorile vechi (Clienți privați / Alte companii) și lipsa categoriei se încadrează la "Lucrări diverse".
function normCategorie(c) {
  if (c === "Strust Eurotherm") return "Nibe";
  return CATEGORII_PROIECT.includes(c) ? c : "Lucrări diverse";
}

function emptyProiect() {
  return { id: null, nume: "", clientId: "", categorie: "", stadiu: "Ofertare", procentExecutie: 0, valoareOferta: "", valoareContract: "",
    costRealizat: "", dataStart: "", dataFinal: "", oreEstimate: "", materialeAchizitionate: "", materialePuseInOpera: "", devize: [] };
}

function ModuleLucrari() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null); // proiect object or null
  const [devizeProiectId, setDevizeProiectId] = useState(null); // id proiect ale cărui devize le vedem
  const [devizForm, setDevizForm] = useState(null); // { proiectId, deviz } sau null
  const [ganttProiectId, setGanttProiectId] = useState(null); // id proiect al cărui Gantt îl vedem
  const [activitateForm, setActivitateForm] = useState(null); // { proiectId, activitate } sau null
  const [filtruCategorie, setFiltruCategorie] = useState("");
  const [tarifeModal, setTarifeModal] = useState(false);

  const clientName = (id) => data.clienti.find((c) => c.id === id)?.nume || "—";
  const angajatName = (id) => data.angajati.find((a) => a.id === id)?.nume || "—";

  function saveActivitate(proiectId, activitate) {
    update((d) => {
      const proiect = d.proiecte.find((p) => p.id === proiectId);
      if (!proiect) return d;
      if (!proiect.activitatiGantt) proiect.activitatiGantt = [];
      const clean = { ...activitate, procent: Math.max(0, Math.min(100, Number(activitate.procent) || 0)) };
      if (activitate.id) proiect.activitatiGantt = proiect.activitatiGantt.map((a) => (a.id === activitate.id ? clean : a));
      else proiect.activitatiGantt.push({ ...clean, id: uid() });
      return d;
    });
    toast("Activitate salvată.");
    setActivitateForm(null);
  }

  function removeActivitate(proiectId, activitateId) {
    update((d) => {
      const proiect = d.proiecte.find((p) => p.id === proiectId);
      if (proiect) proiect.activitatiGantt = (proiect.activitatiGantt || []).filter((a) => a.id !== activitateId);
      return d;
    });
    toast("Activitate ștearsă.", "warn");
  }

  function save(p) {
    const isNew = !p.id;
    const newId = isNew ? uid() : p.id;
    update((d) => {
      const clean = {
        ...p,
        valoareOferta: p.valoareOferta === "" ? null : Number(p.valoareOferta),
        valoareContract: p.valoareContract === "" ? null : Number(p.valoareContract),
        costRealizat: Number(p.costRealizat) || 0,
        procentExecutie: Math.max(0, Math.min(100, Number(p.procentExecutie) || 0)),
        oreEstimate: p.oreEstimate === "" || p.oreEstimate == null ? "" : Math.max(0, Number(p.oreEstimate) || 0),
        materialeAchizitionate: Number(p.materialeAchizitionate) || 0,
        materialePuseInOpera: Number(p.materialePuseInOpera) || 0,
      };
      if (!isNew) {
        d.proiecte = d.proiecte.map((x) => (x.id === p.id ? { ...x, ...clean } : x));
      } else {
        d.proiecte.push({ ...clean, id: newId, devize: [], activitatiGantt: [] });
      }
      return d;
    });
    if (isNew) {
      toast("Proiect adăugat. Acum adaugă devizul inițial.");
      setModal(null);
      setDevizForm({ proiectId: newId, deviz: { moment: "Inițial (ofertă)", data: "", linii: [] } });
    } else {
      toast("Proiect actualizat.");
      setModal(null);
    }
  }

  function remove(id) {
    update((d) => { d.proiecte = d.proiecte.filter((p) => p.id !== id); return d; });
    toast("Proiect șters.", "warn");
  }

  function saveDeviz(proiectId, deviz) {
    update((d) => {
      const proiect = d.proiecte.find((p) => p.id === proiectId);
      if (!proiect) return d;
      if (!proiect.devize) proiect.devize = [];
      if (deviz.id) {
        proiect.devize = proiect.devize.map((dv) => (dv.id === deviz.id ? deviz : dv));
      } else {
        proiect.devize.push({ ...deviz, id: uid() });
      }
      return d;
    });
    toast("Deviz salvat.");
    setDevizForm(null);
  }

  function removeDeviz(proiectId, devizId) {
    update((d) => {
      const proiect = d.proiecte.find((p) => p.id === proiectId);
      if (proiect) proiect.devize = (proiect.devize || []).filter((dv) => dv.id !== devizId);
      return d;
    });
    toast("Deviz șters.", "warn");
  }

  const proiectDeviz = data.proiecte.find((p) => p.id === devizeProiectId);
  const proiecteFiltrate = filtruCategorie ? data.proiecte.filter((p) => normCategorie(p.categorie) === filtruCategorie) : data.proiecte;
  const grupe = CATEGORII_PROIECT.map((cat) => ({ cat, items: proiecteFiltrate.filter((p) => normCategorie(p.categorie) === cat) })).filter((g) => g.items.length > 0);

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Ofertare → contract → execuție → contabilizarea costurilor, per proiect.</p>
        <div className="btn-row">
          <select value={filtruCategorie} onChange={(e) => setFiltruCategorie(e.target.value)}>
            <option value="">Toate categoriile</option>
            {CATEGORII_PROIECT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {TARIFE_CONTRACTE.length > 0 && <Button variant="ghost" onClick={() => setTarifeModal(true)}>Tarife contracte</Button>}
          <Button onClick={() => setModal(emptyProiect())}><IconPlus size={15} /> Proiect nou</Button>
        </div>
      </div>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Proiect</th><th>Client</th><th>Stadiu</th><th>Execuție</th>
              <th className="num">Valoare contract</th><th className="num">Cost realizat</th>
              <th className="num">Marjă</th><th></th>
            </tr>
          </thead>
          <tbody>
            {grupe.map(({ cat, items }) => {
              const totVal = items.reduce((sum, p) => sum + (p.valoareContract ?? p.valoareOferta ?? 0), 0);
              const totCost = items.reduce((sum, p) => sum + (p.costRealizat || 0), 0);
              return (
              <React.Fragment key={cat}>
                <tr className="group-row">
                  <td colSpan={8} style={{ background: "var(--bg)", borderTop: "2px solid var(--blueprint)" }}>
                    <strong>{cat}</strong>
                    <span className="cell-sub mono" style={{ marginLeft: 10 }}>
                      {items.length} {items.length === 1 ? "lucrare" : "lucrări"} · contracte {ron(totVal)} · cost {ron(totCost)} · marjă {ron(totVal - totCost)}
                    </span>
                  </td>
                </tr>
            {items.map((p) => {
              const val = p.valoareContract ?? p.valoareOferta ?? 0;
              const marja = val - (p.costRealizat || 0);
              const nrDevize = (p.devize || []).length;
              return (
                <tr key={p.id}>
                  <td>
                    <div className="cell-title">{p.nume}</div>
                    <div className="cell-sub mono">{fmtDate(p.dataStart)} → {fmtDate(p.dataFinal)}</div>
                  </td>
                  <td>{clientName(p.clientId)}</td>
                  <td><Badge tone={p.stadiu === "Finalizat" ? "ok" : p.stadiu === "Execuție" ? "accent" : "neutral"}>{p.stadiu}</Badge></td>
                  <td>
                    <div className="mini-bar"><div className="mini-bar-fill" style={{ width: (p.procentExecutie || 0) + "%" }} /></div>
                    <div className="cell-sub mono">{p.procentExecutie || 0}%</div>
                  </td>
                  <td className="num mono">{ron(val)}</td>
                  <td className="num mono">{ron(p.costRealizat)}</td>
                  <td className={`num mono ${marja < 0 ? "text-danger" : "text-ok"}`}>{ron(marja)}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={() => setGanttProiectId(p.id)}><IconGantt size={13} /> Gantt</Button>
                    <Button size="sm" variant={nrDevize === 0 ? "danger" : "ghost"} onClick={() => setDevizeProiectId(p.id)}>Devize ({nrDevize}){nrDevize === 0 ? " ⚠" : ""}</Button>
                    <IconButton title="Editează" onClick={() => setModal(p)}><IconEdit size={15} /></IconButton>
                    <ConfirmDelete onConfirm={() => remove(p.id)} />
                  </td>
                </tr>
              );
            })}
              </React.Fragment>
              );
            })}
            {proiecteFiltrate.length === 0 && <tr><td colSpan={8}><EmptyState text="Niciun proiect încă." /></td></tr>}
          </tbody>
        </table>
      </Card>

      <Modal open={tarifeModal} onClose={() => setTarifeModal(false)} title="Tarife din contracte" wide>
        {tarifeModal && <TarifeContract />}
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează proiect" : "Proiect nou"} wide>
        {modal && <ProiectForm proiect={modal} clienti={data.clienti} onSave={save} onCancel={() => setModal(null)} />}
      </Modal>

      <Modal open={!!proiectDeviz} onClose={() => setDevizeProiectId(null)} title={`Devize — ${proiectDeviz?.nume || ""}`} wide>
        {proiectDeviz && (
          <div className="stack-md">
            <div className="section-toolbar">
              <p className="section-intro">Deviz inițial (ofertă), lucrări suplimentare pe parcurs și deviz final, per proiect.</p>
              <Button size="sm" onClick={() => setDevizForm({ proiectId: proiectDeviz.id, deviz: { moment: "Inițial (ofertă)", data: "", linii: [] } })}>
                <IconPlus size={14} /> Deviz nou
              </Button>
            </div>
            {(proiectDeviz.devize || []).length === 0 ? <EmptyState text="Niciun deviz încă pentru acest proiect." /> : (
              <ul className="request-list">
                {proiectDeviz.devize.map((dv) => (
                  <li key={dv.id}>
                    <div>
                      <div className="cell-title">
                        <Badge tone={dv.moment === "Final" ? "ok" : dv.moment === "Suplimentar" ? "warn" : "accent"}>{dv.moment}</Badge>
                        {" "}{fmtDate(dv.data)}
                      </div>
                      <div className="cell-sub">{(dv.linii || []).length} linii · {CATEGORII_DEVIZ.map((cat) => {
                        const t = (dv.linii || []).filter((l) => l.categorie === cat).reduce((s, l) => s + totalLinie(l), 0);
                        return t ? `${cat}: ${ron(t)}` : null;
                      }).filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="btn-row">
                      <span className="mono cell-title">{ron(totalDeviz(dv))}</span>
                      <IconButton title="Editează" onClick={() => setDevizForm({ proiectId: proiectDeviz.id, deviz: dv })}><IconEdit size={15} /></IconButton>
                      <ConfirmDelete onConfirm={() => removeDeviz(proiectDeviz.id, dv.id)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="hint-block">Total toate devizele: <strong className="mono">{ron(totalToateDevizele(proiectDeviz))}</strong></div>
          </div>
        )}
      </Modal>

      <Modal open={!!devizForm} onClose={() => setDevizForm(null)} title={devizForm?.deviz?.id ? "Editează deviz" : "Deviz nou"} wide>
        {devizForm && <DevizForm initial={devizForm.deviz} onSave={(dv) => saveDeviz(devizForm.proiectId, dv)} onCancel={() => setDevizForm(null)} />}
      </Modal>

      <Modal open={!!ganttProiectId} onClose={() => setGanttProiectId(null)} title={`Grafic Gantt — ${data.proiecte.find((p) => p.id === ganttProiectId)?.nume || ""}`} wide>
        {ganttProiectId && (() => {
          const proiect = data.proiecte.find((p) => p.id === ganttProiectId);
          const activitati = proiect?.activitatiGantt || [];
          return (
            <div className="stack-md">
              <div className="section-toolbar">
                <p className="section-intro">Planificarea activităților proiectului, cu responsabil alocat din Gestiune Personal.</p>
                <Button size="sm" onClick={() => setActivitateForm({ proiectId: proiect.id, activitate: { denumire: "", dataStart: proiect.dataStart || "", dataFinal: proiect.dataFinal || "", procent: 0, angajatId: "" } })}>
                  <IconPlus size={14} /> Activitate nouă
                </Button>
              </div>
              {activitati.length === 0 ? <EmptyState text="Nicio activitate încă — adaugă prima activitate pentru a genera graficul Gantt." /> : (
                <>
                  <GanttChart activitati={activitati} angajatName={angajatName} />
                  <table className="table">
                    <thead><tr><th>Activitate</th><th>Responsabil</th><th>Perioadă</th><th className="num">% finalizare</th><th></th></tr></thead>
                    <tbody>
                      {activitati.map((a) => (
                        <tr key={a.id}>
                          <td className="cell-title">{a.denumire}</td>
                          <td>{a.angajatId ? angajatName(a.angajatId) : <span className="muted">—</span>}</td>
                          <td className="mono cell-sub">{fmtDate(a.dataStart)} → {fmtDate(a.dataFinal)}</td>
                          <td className="num mono">{a.procent}%</td>
                          <td className="actions">
                            <IconButton title="Editează" onClick={() => setActivitateForm({ proiectId: proiect.id, activitate: a })}><IconEdit size={15} /></IconButton>
                            <ConfirmDelete onConfirm={() => removeActivitate(proiect.id, a.id)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!activitateForm} onClose={() => setActivitateForm(null)} title={activitateForm?.activitate?.id ? "Editează activitate" : "Activitate nouă"}>
        {activitateForm && (
          <ActivitateForm
            initial={activitateForm.activitate}
            angajati={data.angajati}
            onSave={(a) => saveActivitate(activitateForm.proiectId, a)}
            onCancel={() => setActivitateForm(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function GanttChart({ activitati, angajatName }) {
  const datesValid = activitati.filter((a) => a.dataStart && a.dataFinal);
  if (datesValid.length === 0) return null;
  const toTime = (s) => new Date(s + "T00:00:00").getTime();
  const minStart = Math.min(...datesValid.map((a) => toTime(a.dataStart)));
  const maxEnd = Math.max(...datesValid.map((a) => toTime(a.dataFinal)));
  const totalSpan = Math.max(1, maxEnd - minStart);

  return (
    <div className="gantt-chart">
      {activitati.map((a) => {
        if (!a.dataStart || !a.dataFinal) return null;
        const left = ((toTime(a.dataStart) - minStart) / totalSpan) * 100;
        const width = Math.max(1.5, ((toTime(a.dataFinal) - toTime(a.dataStart)) / totalSpan) * 100);
        return (
          <div className="gantt-row" key={a.id}>
            <div className="gantt-label">
              <span>{a.denumire}</span>
              {a.angajatId && <span className="cell-sub"> · {angajatName(a.angajatId)}</span>}
            </div>
            <div className="gantt-track">
              <div className="gantt-bar" style={{ left: left + "%", width: width + "%" }}>
                <div className="gantt-bar-fill" style={{ width: a.procent + "%" }} />
                <span className="gantt-bar-label">{a.procent}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivitateForm({ initial, angajati, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Denumire activitate" wide><input required value={f.denumire} onChange={set("denumire")} /></Field>
      <Field label="Data început"><input type="date" required value={f.dataStart} onChange={set("dataStart")} /></Field>
      <Field label="Data sfârșit"><input type="date" required value={f.dataFinal} onChange={set("dataFinal")} /></Field>
      <Field label="% finalizare"><input type="number" min="0" max="100" value={f.procent} onChange={set("procent")} /></Field>
      <Field label="Responsabil">
        <select value={f.angajatId || ""} onChange={set("angajatId")}>
          <option value="">— fără responsabil —</option>
          {angajati.map((a) => <option key={a.id} value={a.id}>{a.nume}</option>)}
        </select>
      </Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}


/* Listă de tarife din contract. Cu `onAdd` adaugă linii în deviz; fără `onAdd` e doar consultare. */
function TarifeContract({ onAdd }) {
  const { data, update } = useData();
  const toast = useToast();
  const [catId, setCatId] = useState(TARIFE_CONTRACTE[0]?.id || "");
  const [q, setQ] = useState("");
  const [grup, setGrup] = useState("");
  const [cursText, setCursText] = useState(data.setari?.cursEur ? String(data.setari.cursEur) : "");
  const cat = TARIFE_CONTRACTE.find((c) => c.id === catId) || TARIFE_CONTRACTE[0] || { titlu: "", contract: "", perioada: "", reguli: [], randuri: [] };
  const curs = Number(String(cursText).replace(",", "."));
  const cursOk = curs > 0;
  const grupe = [...new Set(cat.randuri.map((r) => r.grup))];
  const term = q.trim().toLowerCase();
  const randuri = cat.randuri.filter((r) => (!grup || r.grup === grup) && (!term || (r.cod + " " + r.den).toLowerCase().includes(term)));

  function salveazaCurs() {
    if (cursOk && curs !== data.setari?.cursEur) update((d) => { d.setari = { ...(d.setari || {}), cursEur: curs }; return d; });
  }
  function adauga(r) {
    const pretRon = r.moneda === "EUR" ? Math.round(r.pret * curs * 100) / 100 : r.pret;
    onAdd({ id: uid(), categorie: r.tip === "piesa" ? "Materiale consumabile" : "Manoperă", cod: r.cod, denumire: r.den, furnizor: "", um: r.um, cantitate: 1, pretUnitar: pretRon });
    toast(`Adăugat în deviz: ${r.cod}`);
  }

  return (
    <div className="stack-md">
      <div className="cell-sub">{cat.contract} · valabil {cat.perioada}</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        {TARIFE_CONTRACTE.length > 1 && (
          <select value={catId} onChange={(e) => { setCatId(e.target.value); setGrup(""); }}>
            {TARIFE_CONTRACTE.map((c) => <option key={c.id} value={c.id}>{c.titlu}</option>)}
          </select>
        )}
        <input placeholder="Caută cod sau denumire…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <select value={grup} onChange={(e) => setGrup(e.target.value)}>
          <option value="">Toate grupele</option>
          {grupe.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {onAdd && (
          <label className="cell-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Curs EUR/RON
            <input type="number" step="any" min="0" style={{ width: 80 }} value={cursText} placeholder="ex. 5.00"
              onChange={(e) => setCursText(e.target.value)} onBlur={salveazaCurs} />
          </label>
        )}
      </div>
      {onAdd && !cursOk && <div className="hint-block" style={{ color: "var(--warn)" }}>Introdu cursul EUR/RON (BNR, din ziua devizului/facturii) ca să poți adăuga filtrele, care sunt în euro. Serviciile (în lei) se pot adăuga oricând.</div>}

      <div style={{ maxHeight: "min(50vh, 420px)", overflowY: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Cod</th><th>Denumire</th><th>UM</th><th className="num">Preț contract</th>{onAdd && <th></th>}</tr>
          </thead>
          <tbody>
            {randuri.map((r) => (
              <tr key={r.cod}>
                <td className="mono">{r.cod}</td>
                <td>
                  <div className="cell-title">{r.den}</div>
                  {r.obs && <div className="cell-sub">{r.obs}</div>}
                </td>
                <td>{r.um}</td>
                <td className="num mono">{fmtPret(r.pret, r.moneda)}{r.moneda === "EUR" && cursOk ? <div className="cell-sub">≈ {fmtPret(r.pret * curs, "RON")}</div> : null}</td>
                {onAdd && (
                  <td>
                    <Button size="sm" variant="ghost" type="button" disabled={r.moneda === "EUR" && !cursOk} onClick={() => adauga(r)}>
                      <IconPlus size={13} /> Adaugă
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {randuri.length === 0 && <tr><td colSpan={onAdd ? 5 : 4}><EmptyState text="Nicio poziție găsită." /></td></tr>}
          </tbody>
        </table>
      </div>

      <details>
        <summary className="cell-sub" style={{ cursor: "pointer" }}>Reguli din contract (sporuri, adaos, facturare)</summary>
        <ul style={{ margin: "8px 0 0 18px" }}>
          {cat.reguli.map((r, i) => <li key={i} className="cell-sub" style={{ marginBottom: 4 }}>{r}</li>)}
        </ul>
      </details>
    </div>
  );
}

function DevizForm({ initial, onSave, onCancel }) {
  const [moment, setMoment] = useState(initial.moment || "Inițial (ofertă)");
  const [data, setDataVal] = useState(initial.data || "");
  const [linii, setLinii] = useState(initial.linii && initial.linii.length ? initial.linii : []);
  const [tarifeOpen, setTarifeOpen] = useState(false);

  function addLinie() {
    setLinii([...linii, { id: uid(), categorie: "Materiale consumabile", cod: "", denumire: "", furnizor: "", um: "buc", cantitate: 1, pretUnitar: 0 }]);
  }
  function updateLinie(id, field, value) {
    setLinii(linii.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }
  function removeLinie(id) {
    setLinii(linii.filter((l) => l.id !== id));
  }

  const totalGeneral = linii.reduce((s, l) => s + totalLinie(l), 0);

  return (
    <form className="stack-md" onSubmit={(e) => { e.preventDefault(); onSave({ id: initial.id, moment, data, linii }); }}>
      <div className="form-grid">
        <Field label="Moment deviz">
          <select value={moment} onChange={(e) => setMoment(e.target.value)}>
            {MOMENTE_DEVIZ.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Data deviz"><input type="date" value={data} onChange={(e) => setDataVal(e.target.value)} /></Field>
      </div>

      <table className="table">
        <thead>
          <tr><th>Categorie</th><th>Cod</th><th>Denumire</th><th>Furnizor</th><th>UM</th><th className="num">Cant.</th><th className="num">Preț unitar</th><th className="num">Total</th><th></th></tr>
        </thead>
        <tbody>
          {linii.map((l) => (
            <tr key={l.id}>
              <td>
                <select value={l.categorie} onChange={(e) => updateLinie(l.id, "categorie", e.target.value)}>
                  {CATEGORII_DEVIZ.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td style={{ width: 70 }}><input value={l.cod || ""} onChange={(e) => updateLinie(l.id, "cod", e.target.value)} placeholder="Cod" /></td>
              <td><input value={l.denumire} onChange={(e) => updateLinie(l.id, "denumire", e.target.value)} placeholder="Denumire" /></td>
              <td style={{ width: 90 }}><input value={l.furnizor || ""} onChange={(e) => updateLinie(l.id, "furnizor", e.target.value)} placeholder="Furnizor" /></td>
              <td style={{ width: 60 }}><input value={l.um} onChange={(e) => updateLinie(l.id, "um", e.target.value)} /></td>
              <td className="num"><input type="number" step="any" style={{ width: 65 }} value={l.cantitate} onChange={(e) => updateLinie(l.id, "cantitate", e.target.value)} /></td>
              <td className="num"><input type="number" step="any" style={{ width: 85 }} value={l.pretUnitar} onChange={(e) => updateLinie(l.id, "pretUnitar", e.target.value)} /></td>
              <td className="num mono">{ron(totalLinie(l))}</td>
              <td><IconButton title="Șterge linia" type="button" onClick={() => removeLinie(l.id)}><IconTrash size={14} /></IconButton></td>
            </tr>
          ))}
          {linii.length === 0 && <tr><td colSpan={9}><EmptyState text="Nicio linie încă — adaugă prima linie de deviz." /></td></tr>}
        </tbody>
      </table>
      <div className="btn-row">
        <Button type="button" variant="ghost" size="sm" onClick={addLinie}><IconPlus size={14} /> Adaugă linie</Button>
        {TARIFE_CONTRACTE.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setTarifeOpen(!tarifeOpen)}>{tarifeOpen ? "Ascunde tarifele contract" : "Din tarife contract (Kaufland)"}</Button>}
      </div>
      {tarifeOpen && <Card><TarifeContract onAdd={(l) => setLinii((cur) => [...cur, l])} /></Card>}

      <div className="hint-block">Total general deviz: <strong className="mono">{ron(totalGeneral)}</strong></div>
      {linii.length === 0 && <div className="hint-block" style={{ color: "var(--danger)" }}>Adaugă cel puțin o linie ca să poți salva devizul.</div>}

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit" disabled={linii.length === 0}>Salvează devizul</Button>
      </div>
    </form>
  );
}

function ProiectForm({ proiect, clienti, onSave, onCancel }) {
  const [f, setF] = useState(proiect.id ? { ...proiect, categorie: normCategorie(proiect.categorie) } : proiect);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Denumire proiect"><input required value={f.nume} onChange={set("nume")} /></Field>
      <Field label="Client">
        <select value={f.clientId} onChange={set("clientId")} required>
          <option value="">Alege client…</option>
          {clienti.map((c) => <option key={c.id} value={c.id}>{c.nume}</option>)}
        </select>
      </Field>
      <Field label="Categorie">
        <select value={f.categorie || ""} onChange={set("categorie")} required>
          <option value="">Alege categorie…</option>
          {CATEGORII_PROIECT.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Stadiu">
        <select value={f.stadiu} onChange={set("stadiu")}>
          {STADII.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Stadiu actual de execuție (%)" hint="0-100, procent de execuție">
        <input type="number" step="any" min="0" max="100" value={f.procentExecutie ?? 0} onChange={set("procentExecutie")} />
      </Field>
      <Field label="Valoare ofertă (RON)"><input type="number" step="any" value={f.valoareOferta} onChange={set("valoareOferta")} /></Field>
      <Field label="Valoare contract (RON)"><input type="number" step="any" value={f.valoareContract} onChange={set("valoareContract")} /></Field>
      <Field label="Cost realizat (RON)"><input type="number" step="any" value={f.costRealizat} onChange={set("costRealizat")} /></Field>
      <Field label="Data start"><input type="date" value={f.dataStart} onChange={set("dataStart")} /></Field>
      <Field label="Data finalizare"><input type="date" value={f.dataFinal} onChange={set("dataFinal")} /></Field>
      <Field label="Ore estimate (manual, opțional)" hint="dacă rămâne gol, se calculează din manopera devizelor"><input type="number" step="any" min="0" value={f.oreEstimate ?? ""} onChange={set("oreEstimate")} /></Field>
      <Field label="Materiale achiziționate (RON)" hint="valoare cumulată comandată/recepționată"><input type="number" step="any" value={f.materialeAchizitionate} onChange={set("materialeAchizitionate")} /></Field>
      <Field label="Materiale puse în operă (RON)" hint="valoare cumulată consumată pe șantier"><input type="number" step="any" value={f.materialePuseInOpera} onChange={set("materialePuseInOpera")} /></Field>
      {!f.id && <div className="hint-block field-wide">După salvare, ți se va cere să adaugi imediat un deviz inițial (cel puțin o linie) — orice proiect are nevoie de un deviz minim.</div>}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

/* =========================================================================
   MODULE: GESTIUNE PERSONAL
   ========================================================================= */

function emptyAngajat() {
  return { id: null, nume: "", rol: "", zileConcediuAnual: 21, zileConcediuFolosite: 0, costOra: 0, certificari: [], medicinaMuncii: { dataExpirare: "" } };
}
function emptyCerere(angajatId = "") {
  return { angajatId, tip: "Odihnă", nrCertificatMedical: "", dataStart: "", dataFinal: "" };
}
function emptyPontaj() {
  return { angajatId: "", proiectId: "", data: "", ore: 8 };
}
function emptySalariu(luna) {
  return {
    id: null, angajatId: "", luna: luna || currentMonthKey,
    zileLucratoare: 21, co: 0, cm: 0, alteInvoiri: 0, zileLucrateExtra: 0, zileLucrate: 21, zilePrestate: 0,
    brutInCM: 0, net: 0, cash: 0, bonuriMasa: 0, cas: 0, cass: 0, impozitVenit: 0, cam: 0, brut: 0, cost: 0,
  };
}

function ModulePersonal() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [cereModal, setCereModal] = useState(false);
  const [pontajModal, setPontajModal] = useState(false);
  const [salariuModal, setSalariuModal] = useState(null); // { angajatId, salariu } sau null
  const [lunaSalarii, setLunaSalarii] = useState(currentMonthKey);
  const [arataFostiAngajati, setArataFostiAngajati] = useState(false);
  const [fisaSalarialaId, setFisaSalarialaId] = useState(null);

  function saveAngajat(a) {
    update((d) => {
      const clean = {
        ...a,
        zileConcediuAnual: Number(a.zileConcediuAnual) || 0,
        zileConcediuFolosite: Number(a.zileConcediuFolosite) || 0,
        costOra: Number(a.costOra) || 0,
        dataIncetare: a.dataIncetare || "",
        activ: !a.dataIncetare,
      };
      if (a.id) d.angajati = d.angajati.map((x) => (x.id === a.id ? { ...x, ...clean } : x));
      else d.angajati.push({ ...clean, id: uid(), certificari: [] });
      return d;
    });
    toast(a.id ? "Angajat actualizat." : "Angajat adăugat.");
    setModal(null);
  }

  function removeAngajat(id) {
    update((d) => { d.angajati = d.angajati.filter((a) => a.id !== id); return d; });
    toast("Angajat șters.", "warn");
  }

  function addCerere(c) {
    // GP-03c: pentru concediul de odihnă, se scad weekendurile și sărbătorile legale;
    // pentru concediul medical, perioada certificatului acoperă zile calendaristice.
    const nrZile = c.tip === "Medical" ? calcZileCalendaristice(c.dataStart, c.dataFinal) : calcZileLucratoare(c.dataStart, c.dataFinal);
    update((d) => { d.concedii.push({ id: uid(), ...c, nrZile, status: "Cerere" }); return d; });
    toast("Cerere de concediu înregistrată.");
    setCereModal(false);
  }

  function decideCerere(id, decizie) {
    update((d) => {
      const c = d.concedii.find((x) => x.id === id);
      if (!c) return d;
      c.status = decizie;
      // doar concediul de odihnă consumă din zilele anuale — concediul medical nu.
      if (decizie === "Avizat" && c.tip !== "Medical") {
        const ang = d.angajati.find((a) => a.id === c.angajatId);
        if (ang) ang.zileConcediuFolosite += c.nrZile;
      }
      return d;
    });
    toast(decizie === "Avizat" ? "Cerere avizată." : "Cerere respinsă.", decizie === "Avizat" ? "ok" : "warn");
  }

  function addPontaj(p) {
    update((d) => {
      if (!d.pontaje) d.pontaje = [];
      d.pontaje.push({ id: uid(), angajatId: p.angajatId, proiectId: p.proiectId, data: p.data, ore: Number(p.ore) || 0 });
      return d;
    });
    toast("Pontaj înregistrat.");
    setPontajModal(false);
  }

  function saveSalariu(s) {
    const clean = {
      ...s,
      zileLucratoare: Number(s.zileLucratoare) || 0, co: Number(s.co) || 0, cm: Number(s.cm) || 0,
      alteInvoiri: Number(s.alteInvoiri) || 0, zileLucrateExtra: Number(s.zileLucrateExtra) || 0,
      zileLucrate: Number(s.zileLucrate) || 0, zilePrestate: Number(s.zilePrestate) || 0,
      brutInCM: Number(s.brutInCM) || 0, net: Number(s.net) || 0, cash: Number(s.cash) || 0,
      bonuriMasa: Number(s.bonuriMasa) || 0, cas: Number(s.cas) || 0, cass: Number(s.cass) || 0,
      impozitVenit: Number(s.impozitVenit) || 0, cam: Number(s.cam) || 0, brut: Number(s.brut) || 0,
      cost: Number(s.cost) || 0,
    };
    update((d) => {
      if (!d.salarii) d.salarii = [];
      if (s.id) d.salarii = d.salarii.map((x) => (x.id === s.id ? clean : x));
      else d.salarii.push({ ...clean, id: uid() });
      return d;
    });
    toast(s.id ? "Stat de plată actualizat." : "Stat de plată adăugat.");
    setSalariuModal(null);
  }

  function aplicaCostOra(angajatId, costOra) {
    update((d) => {
      const a = d.angajati.find((x) => x.id === angajatId);
      if (a) a.costOra = Math.round(costOra * 100) / 100;
      return d;
    });
    toast("Cost/oră actualizat pe fișa angajatului.");
  }

  const angajatName = (id) => data.angajati.find((a) => a.id === id)?.nume || "—";
  const proiectName = (id) => data.proiecte.find((p) => p.id === id)?.nume || "—";
  const cereriPending = data.concedii.filter((c) => c.status === "Cerere");
  const cereriIstoric = data.concedii.filter((c) => c.status !== "Cerere");
  const pontaje = data.pontaje || [];

  // GP-10c: raport ore & cost manoperă per angajat per proiect (interconectare cu Gestiune Lucrări)
  const raportOrePeProiect = useMemo(() => {
    const grupuri = {};
    pontaje.forEach((p) => {
      const key = p.angajatId + "|" + p.proiectId;
      if (!grupuri[key]) grupuri[key] = { angajatId: p.angajatId, proiectId: p.proiectId, ore: 0 };
      grupuri[key].ore += Number(p.ore) || 0;
    });
    return Object.values(grupuri).map((g) => {
      const angajat = data.angajati.find((a) => a.id === g.angajatId);
      return { ...g, cost: g.ore * (angajat?.costOra || 0) };
    }).sort((a, b) => b.ore - a.ore);
  }, [pontaje, data.angajati]);

  // alerte medicina muncii, aliniate ca stil cu certificarile
  function alertaAngajat(a) {
    const certs = [...(a.certificari || [])].sort((x, y) => (daysUntil(x.dataExpirare) ?? 9e9) - (daysUntil(y.dataExpirare) ?? 9e9));
    const candidati = [];
    if (certs[0]) candidati.push({ eticheta: certs[0].nume, data: certs[0].dataExpirare });
    if (a.medicinaMuncii?.dataExpirare) candidati.push({ eticheta: "Medicina muncii", data: a.medicinaMuncii.dataExpirare });
    candidati.sort((x, y) => (daysUntil(x.data) ?? 9e9) - (daysUntil(y.data) ?? 9e9));
    return candidati[0];
  }

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Pontaj pe proiecte, concedii (odihnă/medical), certificări și medicina muncii.</p>
        <div className="btn-row">
          <Button variant="ghost" onClick={() => setPontajModal(true)}><IconPlus size={15} /> Pontaj</Button>
          <Button variant="ghost" onClick={() => setCereModal(true)}><IconPlus size={15} /> Cerere concediu</Button>
          <Button onClick={() => setModal(emptyAngajat())}><IconPlus size={15} /> Angajat nou</Button>
        </div>
      </div>

      <Card title={`Angajați (${data.angajati.filter((a) => a.activ !== false).length})`}>
        <label className="checkbox-row">
          <input type="checkbox" checked={arataFostiAngajati} onChange={(e) => setArataFostiAngajati(e.target.checked)} /> Arată și foștii angajați
        </label>
        <table className="table">
          <thead><tr><th>Nr.</th><th>Nume</th><th>Rol</th><th className="num">Cost/oră</th><th className="num">Zile concediu rămase</th><th>Cea mai apropiată alertă</th><th></th></tr></thead>
          <tbody>
            {(arataFostiAngajati ? data.angajati : data.angajati.filter((a) => a.activ !== false)).map((a, idx) => {
              const ramase = a.zileConcediuAnual - a.zileConcediuFolosite;
              const alerta = alertaAngajat(a);
              return (
                <tr key={a.id}>
                  <td className="mono muted">{idx + 1}</td>
                  <td className="cell-title">{a.nume}{a.activ === false && <Badge tone="neutral"> Inactiv din {fmtDate(a.dataIncetare)}</Badge>}</td>
                  <td>{a.rol}</td>
                  <td className="num mono">{ron(a.costOra)}</td>
                  <td className={`num mono ${ramase <= 3 ? "text-warn" : ""}`}>{ramase} / {a.zileConcediuAnual}</td>
                  <td>{alerta ? <><span>{alerta.eticheta} </span><UrgencyBadge date={alerta.data} /></> : <span className="muted">—</span>}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={() => setFisaSalarialaId(a.id)}>Fișă salarială</Button>
                    <IconButton title="Editează" onClick={() => setModal(a)}><IconEdit size={15} /></IconButton>
                    <ConfirmDelete onConfirm={() => removeAngajat(a.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="grid-2">
        <Card title="Cereri în așteptare">
          {cereriPending.length === 0 ? <EmptyState text="Nicio cerere în așteptare." /> : (
            <ul className="request-list">
              {cereriPending.map((c) => (
                <li key={c.id}>
                  <div>
                    <div className="cell-title">{angajatName(c.angajatId)} <Badge tone={c.tip === "Medical" ? "warn" : "neutral"}>{c.tip}</Badge></div>
                    <div className="cell-sub mono">{fmtDate(c.dataStart)} → {fmtDate(c.dataFinal)} · {c.nrZile} zile{c.nrCertificatMedical ? ` · CM ${c.nrCertificatMedical}` : ""}</div>
                  </div>
                  <div className="btn-row">
                    <Button size="sm" variant="ok" onClick={() => decideCerere(c.id, "Avizat")}><IconCheck size={14} /> Avizează</Button>
                    <Button size="sm" variant="ghost" onClick={() => decideCerere(c.id, "Respins")}>Respinge</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Istoric concedii">
          {cereriIstoric.length === 0 ? <EmptyState text="Fără istoric încă." /> : (
            <ul className="request-list">
              {cereriIstoric.map((c) => (
                <li key={c.id}>
                  <div>
                    <div className="cell-title">{angajatName(c.angajatId)} <Badge tone={c.tip === "Medical" ? "warn" : "neutral"}>{c.tip}</Badge></div>
                    <div className="cell-sub mono">{fmtDate(c.dataStart)} → {fmtDate(c.dataFinal)} · {c.nrZile} zile</div>
                  </div>
                  <div className="btn-row">
                    <Badge tone={c.status === "Avizat" ? "ok" : "danger"}>{c.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => descarcaDecizieConcediu(data.angajati.find((a) => a.id === c.angajatId), c)}>Descarcă decizia</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Raport ore & cost manoperă per angajat per proiect" action={<span className="cell-sub">interconectat cu Gestiune Lucrări</span>}>
        {raportOrePeProiect.length === 0 ? <EmptyState text="Niciun pontaj înregistrat încă." /> : (
          <table className="table">
            <thead><tr><th>Angajat</th><th>Proiect</th><th className="num">Ore</th><th className="num">Cost manoperă</th></tr></thead>
            <tbody>
              {raportOrePeProiect.map((r, i) => (
                <tr key={i}>
                  <td>{angajatName(r.angajatId)}</td>
                  <td>{proiectName(r.proiectId)}</td>
                  <td className="num mono">{r.ore}</td>
                  <td className="num mono">{ron(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Situație salarii (stat de plată lunar)"
        action={
          <div className="btn-row">
            <select value={lunaSalarii} onChange={(e) => setLunaSalarii(e.target.value)}>
              {[...new Set([currentMonthKey, ...(data.salarii || []).map((s) => s.luna)])].sort().reverse().map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <Button size="sm" onClick={() => setSalariuModal({ angajatId: "", salariu: emptySalariu(lunaSalarii) })}><IconPlus size={14} /> Salariu nou</Button>
          </div>
        }
      >
        <table className="table">
          <thead><tr><th>Angajat</th><th className="num">Zile lucrate</th><th className="num">CO</th><th className="num">CM</th><th className="num">Brut</th><th className="num">Net</th><th className="num">Cost</th><th className="num">Cost/zi</th><th className="num">Cost/oră</th><th></th></tr></thead>
          <tbody>
            {(data.salarii || []).filter((s) => s.luna === lunaSalarii).map((s) => {
              const cz = costZiSalariu(s), co2 = costOraSalariu(s);
              return (
                <tr key={s.id}>
                  <td className="cell-title">{angajatName(s.angajatId)}</td>
                  <td className="num mono">{s.zileLucrate}</td>
                  <td className="num mono">{s.co}</td>
                  <td className="num mono">{s.cm}</td>
                  <td className="num mono">{ron(s.brut)}</td>
                  <td className="num mono">{ron(s.net)}</td>
                  <td className="num mono">{ron(s.cost)}</td>
                  <td className="num mono">{ron(cz)}</td>
                  <td className="num mono">{ron(co2)}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={() => aplicaCostOra(s.angajatId, co2)}>Aplică cost/oră</Button>
                    <IconButton title="Editează" onClick={() => setSalariuModal({ angajatId: s.angajatId, salariu: s })}><IconEdit size={15} /></IconButton>
                  </td>
                </tr>
              );
            })}
            {(data.salarii || []).filter((s) => s.luna === lunaSalarii).length === 0 && <tr><td colSpan={10}><EmptyState text="Niciun stat de plată pentru luna selectată." /></td></tr>}
          </tbody>
        </table>
      </Card>

      <Modal open={!!salariuModal} onClose={() => setSalariuModal(null)} title={salariuModal?.salariu?.id ? "Editează stat de plată" : "Stat de plată nou"} wide>
        {salariuModal && <SalariuForm angajati={data.angajati} initial={salariuModal.salariu} onSave={saveSalariu} onCancel={() => setSalariuModal(null)} />}
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează angajat" : "Angajat nou"}>
        {modal && <AngajatForm angajat={modal} onSave={saveAngajat} onCancel={() => setModal(null)} />}
      </Modal>
      <Modal open={cereModal} onClose={() => setCereModal(false)} title="Cerere de concediu">
        <CerereForm angajati={data.angajati} onSave={addCerere} onCancel={() => setCereModal(false)} />
      </Modal>
      <Modal open={pontajModal} onClose={() => setPontajModal(false)} title="Pontaj pe proiect">
        <PontajForm angajati={data.angajati} proiecte={data.proiecte} onSave={addPontaj} onCancel={() => setPontajModal(false)} />
      </Modal>
      <Modal open={!!fisaSalarialaId} onClose={() => setFisaSalarialaId(null)} title={`Fișă salarială — ${data.angajati.find((a) => a.id === fisaSalarialaId)?.nume || ""}`} wide>
        {fisaSalarialaId && (
          <FisaSalariala
            angajat={data.angajati.find((a) => a.id === fisaSalarialaId)}
            salarii={data.salarii.filter((s) => s.angajatId === fisaSalarialaId)}
            onSalariuNou={() => { setFisaSalarialaId(null); setSalariuModal({ angajatId: fisaSalarialaId, salariu: { ...emptySalariu(currentMonthKey), angajatId: fisaSalarialaId } }); }}
            onAplicaCostOra={aplicaCostOra}
          />
        )}
      </Modal>

    </div>
  );
}

function AngajatForm({ angajat, onSave, onCancel }) {
  const [f, setF] = useState({ ...angajat, medicinaMuncii: angajat.medicinaMuncii || { dataExpirare: "" } });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Nume"><input required value={f.nume} onChange={set("nume")} /></Field>
      <Field label="Rol"><input required value={f.rol} onChange={set("rol")} /></Field>
      <Field label="Zile concediu anual"><input type="number" step="any" value={f.zileConcediuAnual} onChange={set("zileConcediuAnual")} /></Field>
      <Field label="Zile concediu folosite"><input type="number" step="any" value={f.zileConcediuFolosite} onChange={set("zileConcediuFolosite")} /></Field>
      <Field label="Cost/oră (RON)" hint="folosit pentru calculul costului de manoperă din pontaj"><input type="number" step="any" value={f.costOra} onChange={set("costOra")} /></Field>
      <Field label="Medicina muncii — expiră la"><input type="date" value={f.medicinaMuncii?.dataExpirare || ""} onChange={(e) => setF({ ...f, medicinaMuncii: { dataExpirare: e.target.value } })} /></Field>
      <Field label="Data încetării contractului" wide><input type="date" value={f.dataIncetare || ""} onChange={set("dataIncetare")} /></Field>
      <div className="hint-block field-wide">Dacă completezi data încetării, angajatul dispare din lista curentă (rămâne în istoric la pontaj/salarii/concedii). Lasă gol pentru un angajat activ.</div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function CerereForm({ angajati, onSave, onCancel }) {
  const [f, setF] = useState(emptyCerere());
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const nrZile = f.dataStart && f.dataFinal
    ? (f.tip === "Medical" ? calcZileCalendaristice(f.dataStart, f.dataFinal) : calcZileLucratoare(f.dataStart, f.dataFinal))
    : null;
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (f.angajatId && f.dataStart && f.dataFinal) onSave(f); }}>
      <Field label="Angajat">
        <select required value={f.angajatId} onChange={set("angajatId")}>
          <option value="">Alege angajat…</option>
          {angajati.map((a) => <option key={a.id} value={a.id}>{a.nume} ({a.zileConcediuAnual - a.zileConcediuFolosite} zile rămase)</option>)}
        </select>
      </Field>
      <Field label="Tip concediu">
        <select value={f.tip} onChange={set("tip")}>
          <option value="Odihnă">Odihnă (CO)</option>
          <option value="Medical">Medical (CM)</option>
        </select>
      </Field>
      <Field label="Data început"><input type="date" required value={f.dataStart} onChange={set("dataStart")} /></Field>
      <Field label="Data sfârșit"><input type="date" required value={f.dataFinal} onChange={set("dataFinal")} /></Field>
      {f.tip === "Medical" && (
        <Field label="Nr. certificat medical" hint="conform înregistrării în REGES" wide>
          <input value={f.nrCertificatMedical} onChange={set("nrCertificatMedical")} />
        </Field>
      )}
      {nrZile !== null && (
        <div className="hint-block">
          Calcul instant: <strong className="mono">{nrZile}</strong> {f.tip === "Medical" ? "zile calendaristice (perioada certificatului)" : "zile lucrătoare (excl. weekend și sărbători legale)"}.
        </div>
      )}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Trimite cererea</Button>
      </div>
    </form>
  );
}

function PontajForm({ angajati, proiecte, onSave, onCancel, initial }) {
  const [f, setF] = useState(initial ? { ...emptyPontaj(), ...initial } : emptyPontaj());
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (f.angajatId && f.proiectId && f.data) onSave(f); }}>
      <Field label="Angajat">
        <select required value={f.angajatId} onChange={set("angajatId")}>
          <option value="">Alege angajat…</option>
          {angajati.map((a) => <option key={a.id} value={a.id}>{a.nume}</option>)}
        </select>
      </Field>
      <Field label="Proiect / lucrare">
        <select required value={f.proiectId} onChange={set("proiectId")}>
          <option value="">Alege proiect…</option>
          {proiecte.map((p) => <option key={p.id} value={p.id}>{p.nume}</option>)}
        </select>
      </Field>
      <Field label="Data"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Ore lucrate"><input type="number" step="any" min="0" max="24" value={f.ore} onChange={set("ore")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează pontajul</Button>
      </div>
    </form>
  );
}

function FisaSalariala({ angajat, salarii, onSalariuNou, onAplicaCostOra }) {
  if (!angajat) return null;
  const istoric = [...salarii].sort((a, b) => (a.luna < b.luna ? 1 : -1));
  return (
    <div className="stack-md">
      <div className="section-toolbar">
        <p className="section-intro">{angajat.rol} · Cost/oră curent: <strong className="mono">{ron(angajat.costOra || 0)}</strong></p>
        <Button size="sm" onClick={onSalariuNou}><IconPlus size={14} /> Salariu nou pentru {angajat.nume}</Button>
      </div>
      {istoric.length === 0 ? <EmptyState text="Niciun stat de plată înregistrat încă pentru acest angajat." /> : (
        <table className="table">
          <thead><tr><th>Luna</th><th className="num">Net</th><th className="num">Bonuri masă</th><th className="num">CAS</th><th className="num">CASS</th><th className="num">Impozit venit</th><th className="num">CAM</th><th className="num">Brut</th><th className="num">Cost/oră</th><th></th></tr></thead>
          <tbody>
            {istoric.map((s) => {
              const cz = costZiSalariu(s), co = costOraSalariu(s);
              return (
                <tr key={s.id}>
                  <td className="cell-title mono">{s.luna}</td>
                  <td className="num mono">{ron(s.net)}</td>
                  <td className="num mono">{ron(s.bonuriMasa)}</td>
                  <td className="num mono">{ron(s.cas)}</td>
                  <td className="num mono">{ron(s.cass)}</td>
                  <td className="num mono">{ron(s.impozitVenit)}</td>
                  <td className="num mono">{ron(s.cam)}</td>
                  <td className="num mono cell-title">{ron(s.brut)}</td>
                  <td className="num mono">{ron(co)}</td>
                  <td className="actions"><Button size="sm" variant="ghost" onClick={() => onAplicaCostOra(s.angajatId, co)}>Aplică</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SalariuForm({ angajati, initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cz = f.zileLucrate ? (Number(f.cost) || 0) / Number(f.zileLucrate) : 0;
  const co = cz / 8;
  return (
    <form className="stack-md" onSubmit={(e) => { e.preventDefault(); if (f.angajatId && f.luna) onSave(f); }}>
      <div className="form-grid">
        <Field label="Angajat">
          <select required value={f.angajatId} onChange={set("angajatId")} disabled={!!f.id}>
            <option value="">Alege angajat…</option>
            {angajati.map((a) => <option key={a.id} value={a.id}>{a.nume}</option>)}
          </select>
        </Field>
        <Field label="Luna" hint="format AAAA-LL"><input required value={f.luna} onChange={set("luna")} placeholder="2026-07" /></Field>
      </div>

      <p className="section-intro">Zile — conform statului de plată curent (zile lucrătoare, CO, CM, alte învoiri, zile lucrate extra, zile lucrate, zile prestate).</p>
      <div className="form-grid">
        <Field label="Zile lucrătoare (calendar)"><input type="number" step="any" value={f.zileLucratoare} onChange={set("zileLucratoare")} /></Field>
        <Field label="Zile CO"><input type="number" step="any" value={f.co} onChange={set("co")} /></Field>
        <Field label="Zile CM"><input type="number" step="any" value={f.cm} onChange={set("cm")} /></Field>
        <Field label="Alte învoiri"><input type="number" step="any" value={f.alteInvoiri} onChange={set("alteInvoiri")} /></Field>
        <Field label="Zile lucrate extra"><input type="number" step="any" value={f.zileLucrateExtra} onChange={set("zileLucrateExtra")} /></Field>
        <Field label="Zile lucrate"><input type="number" step="any" value={f.zileLucrate} onChange={set("zileLucrate")} /></Field>
        <Field label="Zile prestate"><input type="number" step="any" value={f.zilePrestate} onChange={set("zilePrestate")} /></Field>
      </div>

      <p className="section-intro">Componente de salarizare (RON).</p>
      <div className="form-grid">
        <Field label="Brut în CIM"><input type="number" step="any" value={f.brutInCM} onChange={set("brutInCM")} /></Field>
        <Field label="Net"><input type="number" step="any" value={f.net} onChange={set("net")} /></Field>
        <Field label="Cash"><input type="number" step="any" value={f.cash} onChange={set("cash")} /></Field>
        <Field label="Bonuri de masă"><input type="number" step="any" value={f.bonuriMasa} onChange={set("bonuriMasa")} /></Field>
        <Field label="CAS"><input type="number" step="any" value={f.cas} onChange={set("cas")} /></Field>
        <Field label="CASS"><input type="number" step="any" value={f.cass} onChange={set("cass")} /></Field>
        <Field label="Impozit pe venit"><input type="number" step="any" value={f.impozitVenit} onChange={set("impozitVenit")} /></Field>
        <Field label="CAM"><input type="number" step="any" value={f.cam} onChange={set("cam")} /></Field>
        <Field label="Brut total"><input type="number" step="any" value={f.brut} onChange={set("brut")} /></Field>
        <Field label="Cost total angajator"><input type="number" step="any" value={f.cost} onChange={set("cost")} /></Field>
      </div>

      <div className="hint-block">
        Calcul automat (GP-13): Cost/zi = <strong className="mono">{ron(cz)}</strong> · Cost/oră = <strong className="mono">{ron(co)}</strong>
      </div>

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează statul de plată</Button>
      </div>
    </form>
  );
}

/* =========================================================================
   MODULE: GESTIUNE CLIENȚI
   ========================================================================= */

function emptyClient() { return { id: null, nume: "", contact: "" }; }

function ModuleClienti() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [ticketModal, setTicketModal] = useState(false);
  const [documenteClientId, setDocumenteClientId] = useState(null);
  const [documentNouModal, setDocumentNouModal] = useState(false);
  const [fisaClientId, setFisaClientId] = useState(null);
  const [locatieForm, setLocatieForm] = useState(null);       // locație în editare sau null
  const [interventieForm, setInterventieForm] = useState(null); // intervenție în editare sau null

  function saveLocatie(loc) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === fisaClientId);
      if (!c) return d;
      if (!c.locatii) c.locatii = [];
      if (loc.id) c.locatii = c.locatii.map((x) => (x.id === loc.id ? { ...x, ...loc } : x));
      else c.locatii.push({ ...loc, id: uid() });
      return d;
    });
    toast(loc.id ? "Locație actualizată." : "Locație adăugată.");
    setLocatieForm(null);
  }
  function removeLocatie(id) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === fisaClientId);
      if (!c) return d;
      c.locatii = (c.locatii || []).filter((l) => l.id !== id);
      c.interventii = (c.interventii || []).map((iv) => (iv.locatieId === id ? { ...iv, locatieId: "" } : iv));
      return d;
    });
    toast("Locație ștearsă.", "warn");
  }
  function saveInterventie(iv) {
    const clean = { ...iv, valoare: iv.valoare === "" || iv.valoare == null ? "" : Number(iv.valoare) };
    update((d) => {
      const c = d.clienti.find((x) => x.id === fisaClientId);
      if (!c) return d;
      if (!c.interventii) c.interventii = [];
      if (iv.id) c.interventii = c.interventii.map((x) => (x.id === iv.id ? clean : x));
      else c.interventii.push({ ...clean, id: uid() });
      return d;
    });
    toast(iv.id ? "Intervenție actualizată." : "Intervenție adăugată.");
    setInterventieForm(null);
  }
  function removeInterventie(id) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === fisaClientId);
      if (c) c.interventii = (c.interventii || []).filter((iv) => iv.id !== id);
      return d;
    });
    toast("Intervenție ștearsă.", "warn");
  }
  function cycleStatusInterventie(id) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === fisaClientId);
      const iv = c && (c.interventii || []).find((x) => x.id === id);
      if (iv) iv.status = STATUSURI_INTERVENTIE[(STATUSURI_INTERVENTIE.indexOf(iv.status) + 1) % STATUSURI_INTERVENTIE.length];
      return d;
    });
  }

  function addDocument(clientId, doc) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === clientId);
      if (!c) return d;
      if (!c.documente) c.documente = [];
      c.documente.push({ ...doc, id: uid(), dataAdaugare: new Date().toISOString().slice(0, 10) });
      return d;
    });
    toast("Document salvat.");
    setDocumentNouModal(false);
  }

  function removeDocument(clientId, docId) {
    update((d) => {
      const c = d.clienti.find((x) => x.id === clientId);
      if (c) c.documente = (c.documente || []).filter((doc) => doc.id !== docId);
      return d;
    });
    toast("Document șters.", "warn");
  }

  function saveClient(c) {
    update((d) => {
      if (c.id) d.clienti = d.clienti.map((x) => (x.id === c.id ? c : x));
      else d.clienti.push({ ...c, id: uid() });
      return d;
    });
    toast(c.id ? "Client actualizat." : "Client adăugat.");
    setModal(null);
  }

  function removeClient(id) {
    update((d) => { d.clienti = d.clienti.filter((c) => c.id !== id); return d; });
    toast("Client șters.", "warn");
  }

  function addTicket(t) {
    update((d) => { d.tichete.push({ id: uid(), ...t, status: "Deschis", dataCreare: new Date().toISOString().slice(0, 10) }); return d; });
    toast("Tichet de service creat.");
    setTicketModal(false);
  }

  function cycleStatus(id) {
    const order = ["Deschis", "În lucru", "Rezolvat"];
    update((d) => {
      const t = d.tichete.find((x) => x.id === id);
      if (t) t.status = order[(order.indexOf(t.status) + 1) % order.length];
      return d;
    });
  }

  const clientName = (id) => data.clienti.find((c) => c.id === id)?.nume || "—";
  const fisaClient = data.clienti.find((c) => c.id === fisaClientId);

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Bază de clienți, garanții acordate și solicitări de service. Deschide „Fișă client" pentru locații, intervenții, lucrări și facturi.</p>
        <div className="btn-row">
          <Button variant="ghost" onClick={() => setTicketModal(true)}><IconPlus size={15} /> Tichet service</Button>
          <Button onClick={() => setModal(emptyClient())}><IconPlus size={15} /> Client nou</Button>
        </div>
      </div>

      <Card title="Clienți">
        <table className="table">
          <thead><tr><th>Client</th><th>Contact</th><th></th></tr></thead>
          <tbody>
            {data.clienti.map((c) => (
              <tr key={c.id}>
                <td className="cell-title"><button className="link-btn" style={{ fontWeight: 600, textAlign: "left" }} onClick={() => setFisaClientId(c.id)}>{c.nume}</button></td>
                <td>{c.contact}</td>
                <td className="actions">
                  <Button size="sm" onClick={() => setFisaClientId(c.id)}>Fișă client</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDocumenteClientId(c.id)}><IconDoc size={13} /> Documente ({(c.documente || []).length})</Button>
                  <IconButton title="Editează" onClick={() => setModal(c)}><IconEdit size={15} /></IconButton>
                  <ConfirmDelete onConfirm={() => removeClient(c.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid-2">
        <Card title="Garanții acordate">
          {data.garantii.length === 0 ? <EmptyState text="Nicio garanție înregistrată." /> : (
            <ul className="request-list">
              {data.garantii.map((g) => (
                <li key={g.id}>
                  <div>
                    <div className="cell-title">{clientName(g.clientId)}</div>
                    <div className="cell-sub">{g.termeni}</div>
                  </div>
                  <UrgencyBadge date={g.dataExpirare} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Tichete de service">
          {data.tichete.length === 0 ? <EmptyState text="Niciun tichet." /> : (
            <ul className="request-list">
              {data.tichete.map((t) => (
                <li key={t.id}>
                  <div>
                    <div className="cell-title">{clientName(t.clientId)}</div>
                    <div className="cell-sub">{t.descriere} · <span className="mono">{fmtDate(t.dataCreare)}</span></div>
                  </div>
                  <button className="badge-btn" onClick={() => cycleStatus(t.id)}>
                    <Badge tone={t.status === "Rezolvat" ? "ok" : t.status === "În lucru" ? "warn" : "danger"}>{t.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează client" : "Client nou"}>
        {modal && <ClientForm client={modal} onSave={saveClient} onCancel={() => setModal(null)} />}
      </Modal>
      <Modal open={ticketModal} onClose={() => setTicketModal(false)} title="Tichet de service nou">
        <TicketForm clienti={data.clienti} onSave={addTicket} onCancel={() => setTicketModal(false)} />
      </Modal>
      <Modal open={!!documenteClientId} onClose={() => setDocumenteClientId(null)} title={`Documente — ${clientName(documenteClientId)}`} wide>
        {documenteClientId && (
          <DocumenteClientList
            documente={data.clienti.find((c) => c.id === documenteClientId)?.documente || []}
            onAdaugaDocument={() => setDocumentNouModal(true)}
            onSterge={(docId) => removeDocument(documenteClientId, docId)}
          />
        )}
      </Modal>
      <Modal open={documentNouModal} onClose={() => setDocumentNouModal(false)} title="Adaugă document">
        <DocumentNouForm onSave={(doc) => addDocument(documenteClientId, doc)} onCancel={() => setDocumentNouModal(false)} />
      </Modal>

      <Modal open={!!fisaClient} onClose={() => setFisaClientId(null)} title={`Fișă client — ${fisaClient?.nume || ""}`} wide>
        {fisaClient && (
          <FisaClient
            client={fisaClient}
            data={data}
            actions={{
              locatieNoua: () => setLocatieForm(emptyLocatie()),
              editLocatie: (l) => setLocatieForm(l),
              stergeLocatie: removeLocatie,
              interventieNoua: (locId) => setInterventieForm(emptyInterventie(locId)),
              editInterventie: (iv) => setInterventieForm(iv),
              stergeInterventie: removeInterventie,
              statusInterventie: cycleStatusInterventie,
            }}
          />
        )}
      </Modal>
      <Modal open={!!locatieForm} onClose={() => setLocatieForm(null)} title={locatieForm?.id ? "Editează locația" : "Locație nouă"}>
        {locatieForm && <LocatieForm locatie={locatieForm} onSave={saveLocatie} onCancel={() => setLocatieForm(null)} />}
      </Modal>
      <Modal open={!!interventieForm} onClose={() => setInterventieForm(null)} title={interventieForm?.id ? "Editează intervenția" : "Intervenție nouă"}>
        {interventieForm && fisaClient && (
          <InterventieForm
            interventie={interventieForm}
            locatii={fisaClient.locatii || []}
            proiecte={data.proiecte.filter((p) => p.clientId === fisaClient.id)}
            angajati={data.angajati}
            onSave={saveInterventie}
            onCancel={() => setInterventieForm(null)}
          />
        )}
      </Modal>
    </div>
  );
}

const TIPURI_DOCUMENT_CLIENT = ["Contract", "Act adițional", "Garanție", "Alt document"];

function DocumenteClientList({ documente, onAdaugaDocument, onSterge, eticheta = "client" }) {
  return (
    <div className="stack-md">
      <div className="section-toolbar">
        <p className="section-intro">Contracte, acte adiționale, garanții și alte documente asociate acestui {eticheta}.</p>
        <Button size="sm" onClick={onAdaugaDocument}><IconPlus size={14} /> Adaugă document</Button>
      </div>
      {documente.length === 0 ? <EmptyState text="Niciun document încărcat încă." /> : (
        <ul className="request-list">
          {documente.map((d) => {
            const tone = d.tip === "Contract" ? "accent" : d.tip === "Garanție" ? "ok" : d.tip === "Act adițional" ? "warn" : "neutral";
            return (
              <li key={d.id}>
                <div>
                  <div className="cell-title"><Badge tone={tone}>{d.tip}</Badge> {d.nume}</div>
                  <div className="cell-sub mono">adăugat {fmtDate(d.dataAdaugare)}{d.numeFisier ? ` · ${d.numeFisier}` : ""}</div>
                </div>
                <div className="btn-row">
                  {d.continut && <a href={d.continut} download={d.numeFisier || d.nume} className="link-btn">Descarcă</a>}
                  <IconButton title="Șterge" onClick={() => onSterge(d.id)}><IconTrash size={15} /></IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DocumentNouForm({ onSave, onCancel }) {
  const [tip, setTip] = useState("Contract");
  const [nume, setNume] = useState("");
  const [continut, setContinut] = useState("");
  const [numeFisier, setNumeFisier] = useState("");
  const [status, setStatus] = useState("Alege un fișier de pe calculator (contract, garanție etc.).");

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setStatus("Fișierul e prea mare (peste 4MB) — alege unul mai mic."); return; }
    setStatus(`Se încarcă ${file.name}…`);
    const reader = new FileReader();
    reader.onload = () => {
      setContinut(reader.result);
      setNumeFisier(file.name);
      if (!nume) setNume(file.name);
      setStatus(`Fișier încărcat: ${file.name} — gata de salvat.`);
    };
    reader.onerror = () => setStatus("Eroare la citirea fișierului.");
    reader.readAsDataURL(file);
  }

  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (!continut) { setStatus("Alege un fișier înainte de a salva."); return; } onSave({ tip, nume: nume || numeFisier || "Document", numeFisier, continut }); }}>
      <Field label="Tip document">
        <select value={tip} onChange={(e) => setTip(e.target.value)}>
          {TIPURI_DOCUMENT_CLIENT.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Denumire" wide><input value={nume} onChange={(e) => setNume(e.target.value)} placeholder="ex: Contract prestări servicii nr. 45" /></Field>
      <Field label="Fișier" wide><input type="file" onChange={handleFile} /></Field>
      <div className="hint-block field-wide">{status}</div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează documentul</Button>
      </div>
    </form>
  );
}


/* =========================================================================
   FIȘĂ CLIENT — locații (magazine), intervenții per locație, lucrări, facturi, service
   Datele stau în obiectul clientului: client.locatii[] și client.interventii[].
   ========================================================================= */

const TIPURI_INTERVENTIE = ["Mentenanță preventivă", "Reparație / defect", "Intervenție urgentă", "Evaluare / ofertare", "Altele"];
const STATUSURI_INTERVENTIE = ["Programată", "Efectuată", "Facturată"];

function emptyLocatie() { return { id: null, nume: "", adresa: "", contact: "" }; }
function emptyInterventie(locatieId = "") {
  return { id: null, locatieId, data: new Date().toISOString().slice(0, 10), tip: TIPURI_INTERVENTIE[0], descriere: "", comanda: "",
    tehnician: "", proiectId: "", valoare: "", status: "Efectuată" };
}

function LocatieForm({ locatie, onSave, onCancel }) {
  const [f, setF] = useState(locatie);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Denumire locație" wide><input required value={f.nume} onChange={set("nume")} placeholder="ex: Kaufland 8970 Bragadiru" /></Field>
      <Field label="Adresă / oraș"><input value={f.adresa} onChange={set("adresa")} /></Field>
      <Field label="Persoană de contact / telefon"><input value={f.contact} onChange={set("contact")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează locația</Button>
      </div>
    </form>
  );
}

function InterventieForm({ interventie, locatii, proiecte, angajati, onSave, onCancel }) {
  const [f, setF] = useState(interventie);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Locație">
        <select value={f.locatieId} onChange={set("locatieId")}>
          <option value="">— fără locație —</option>
          {locatii.map((l) => <option key={l.id} value={l.id}>{l.nume}</option>)}
        </select>
      </Field>
      <Field label="Data intervenției"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Tip intervenție">
        <select value={f.tip} onChange={set("tip")}>{TIPURI_INTERVENTIE.map((t) => <option key={t}>{t}</option>)}</select>
      </Field>
      <Field label="Status">
        <select value={f.status} onChange={set("status")}>{STATUSURI_INTERVENTIE.map((s) => <option key={s}>{s}</option>)}</select>
      </Field>
      <Field label="Descriere / constatări" wide><textarea rows={3} required value={f.descriere} onChange={set("descriere")} /></Field>
      <Field label="Nr. comandă / referință" hint="ex. comanda SAP primită de la client"><input value={f.comanda} onChange={set("comanda")} /></Field>
      <Field label="Tehnician">
        <select value={f.tehnician} onChange={set("tehnician")}>
          <option value="">—</option>
          {angajati.filter((a) => a.activ !== false).map((a) => <option key={a.id} value={a.nume}>{a.nume}</option>)}
        </select>
      </Field>
      <Field label="Lucrare asociată (opțional)">
        <select value={f.proiectId || ""} onChange={set("proiectId")}>
          <option value="">—</option>
          {proiecte.map((p) => <option key={p.id} value={p.id}>{p.nume}</option>)}
        </select>
      </Field>
      <Field label="Valoare fără TVA (RON, opțional)"><input type="number" step="any" value={f.valoare} onChange={set("valoare")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează intervenția</Button>
      </div>
    </form>
  );
}

function FisaClient({ client, data, actions }) {
  const [tab, setTab] = useState("interventii");
  const [locFiltru, setLocFiltru] = useState(""); // "" = toate, "__fara" = fără locație, altfel id locație
  const locatii = client.locatii || [];
  const toate = [...(client.interventii || [])].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const locNume = (id) => locatii.find((l) => l.id === id)?.nume || "— fără locație —";
  const interventii = toate.filter((iv) => !locFiltru || (locFiltru === "__fara" ? !locatii.some((l) => l.id === iv.locatieId) : iv.locatieId === locFiltru));
  const proiecte = data.proiecte.filter((p) => p.clientId === client.id);
  const proiectIds = new Set(proiecte.map((p) => p.id));
  const prima = (client.nume || "").split(/[\s—–-]+/)[0].toLowerCase();
  const facturi = data.facturi.filter((f) => f.tip === "emisa" && (proiectIds.has(f.proiectId) || (prima.length >= 4 && (f.partener || "").toLowerCase().includes(prima))))
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const tichete = data.tichete.filter((t) => t.clientId === client.id);
  const garantii = data.garantii.filter((g) => g.clientId === client.id);
  const totalFacturat = facturi.reduce((s, f) => s + (Number(f.valoareFaraTva) || 0), 0);
  const deIncasat = facturi.filter((f) => f.status !== "Încasată").reduce((s, f) => s + (Number(f.valoareFaraTva) || 0) * (1 + (Number(f.cotaTva) || 0) / 100), 0);
  const proiectNume = (id) => data.proiecte.find((p) => p.id === id)?.nume || "—";

  const statLoc = (l) => {
    const ivs = toate.filter((iv) => iv.locatieId === l.id);
    return { nr: ivs.length, ultima: ivs[0]?.data || "", valoare: ivs.reduce((s, iv) => s + (Number(iv.valoare) || 0), 0) };
  };
  const fara = toate.filter((iv) => !locatii.some((l) => l.id === iv.locatieId));
  const TABS = [
    { key: "interventii", label: `Intervenții (${toate.length})` },
    { key: "lucrari", label: `Lucrări (${proiecte.length})` },
    { key: "facturi", label: `Facturi (${facturi.length})` },
    { key: "service", label: `Service (${tichete.length + garantii.length})` },
  ];

  return (
    <div className="stack-md">
      <div className="grid-4 fisa-kpi">
        <Card><div className="kpi-label">Locații</div><div className="kpi-value" style={{ fontSize: 20 }}>{locatii.length}</div></Card>
        <Card><div className="kpi-label">Intervenții</div><div className="kpi-value" style={{ fontSize: 20 }}>{toate.length}</div></Card>
        <Card><div className="kpi-label">Facturat (fără TVA)</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(totalFacturat)}</div></Card>
        <Card><div className="kpi-label">De încasat (cu TVA)</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(deIncasat)}</div></Card>
      </div>
      {client.contact && <div className="cell-sub">Contact: {client.contact}</div>}

      <div className="tab-row">
        {TABS.map((t) => <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {tab === "interventii" && (
        <div className="stack-md">
          <div className="section-toolbar">
            <p className="section-intro">Locațiile (magazinele) clientului și istoricul intervențiilor la fiecare. Apasă pe o locație ca să vezi doar intervențiile ei.</p>
            <div className="btn-row">
              <Button size="sm" variant="ghost" onClick={() => actions.locatieNoua()}><IconPlus size={14} /> Locație nouă</Button>
              <Button size="sm" onClick={() => actions.interventieNoua(locFiltru && locFiltru !== "__fara" ? locFiltru : "")}><IconPlus size={14} /> Intervenție nouă</Button>
            </div>
          </div>

          {locatii.length === 0 ? <EmptyState text="Nicio locație încă — adaugă prima locație (de ex. un magazin) ca să grupezi intervențiile." /> : (
            <div style={{ overflowX: "auto" }}><table className="table">
              <thead><tr><th>Locație</th><th>Adresă</th><th className="num">Intervenții</th><th>Ultima</th><th className="num">Valoare</th><th></th></tr></thead>
              <tbody>
                <tr onClick={() => setLocFiltru("")} style={{ cursor: "pointer", background: locFiltru === "" ? "var(--signal-soft)" : undefined }}>
                  <td className="cell-title">Toate locațiile</td><td></td><td className="num mono">{toate.length}</td><td></td><td></td><td></td>
                </tr>
                {locatii.map((l) => {
                  const st = statLoc(l);
                  return (
                    <tr key={l.id} onClick={() => setLocFiltru(l.id)} style={{ cursor: "pointer", background: locFiltru === l.id ? "var(--signal-soft)" : undefined }}>
                      <td><div className="cell-title">{l.nume}</div>{l.contact && <div className="cell-sub">{l.contact}</div>}</td>
                      <td>{l.adresa}</td>
                      <td className="num mono">{st.nr}</td>
                      <td className="mono">{st.ultima ? fmtDate(st.ultima) : "—"}</td>
                      <td className="num mono">{st.valoare ? ron(st.valoare) : "—"}</td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <IconButton title="Editează locația" onClick={() => actions.editLocatie(l)}><IconEdit size={15} /></IconButton>
                        <ConfirmDelete title="Ștergi locația? Intervențiile rămân, fără locație." onConfirm={() => actions.stergeLocatie(l.id)} />
                      </td>
                    </tr>
                  );
                })}
                {fara.length > 0 && (
                  <tr onClick={() => setLocFiltru("__fara")} style={{ cursor: "pointer", background: locFiltru === "__fara" ? "var(--signal-soft)" : undefined }}>
                    <td className="cell-sub">— fără locație —</td><td></td><td className="num mono">{fara.length}</td><td></td><td></td><td></td>
                  </tr>
                )}
              </tbody>
            </table></div>
          )}

          <h4 style={{ margin: "6px 0 0" }}>{locFiltru === "" ? "Toate intervențiile" : locFiltru === "__fara" ? "Intervenții fără locație" : `Intervenții — ${locNume(locFiltru)}`}</h4>
          {interventii.length === 0 ? <EmptyState text="Nicio intervenție înregistrată." /> : (
            <div style={{ overflowX: "auto" }}><table className="table">
              <thead><tr><th>Data</th>{locFiltru === "" && <th>Locație</th>}<th>Tip</th><th>Descriere</th><th>Tehnician</th><th>Status</th><th className="num">Valoare</th><th></th></tr></thead>
              <tbody>
                {interventii.map((iv) => (
                  <tr key={iv.id}>
                    <td className="mono">{fmtDate(iv.data)}</td>
                    {locFiltru === "" && <td>{locNume(iv.locatieId)}</td>}
                    <td>{iv.tip}</td>
                    <td>
                      <div>{iv.descriere}</div>
                      {(iv.comanda || iv.proiectId) && <div className="cell-sub">{iv.comanda ? `Comanda ${iv.comanda}` : ""}{iv.comanda && iv.proiectId ? " · " : ""}{iv.proiectId ? proiectNume(iv.proiectId) : ""}</div>}
                    </td>
                    <td>{iv.tehnician || "—"}</td>
                    <td>
                      <button className="badge-btn" title="Schimbă statusul" onClick={() => actions.statusInterventie(iv.id)}>
                        <Badge tone={iv.status === "Facturată" ? "ok" : iv.status === "Efectuată" ? "accent" : "warn"}>{iv.status}</Badge>
                      </button>
                    </td>
                    <td className="num mono">{iv.valoare ? ron(iv.valoare) : "—"}</td>
                    <td className="actions">
                      <IconButton title="Editează" onClick={() => actions.editInterventie(iv)}><IconEdit size={15} /></IconButton>
                      <ConfirmDelete onConfirm={() => actions.stergeInterventie(iv.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "lucrari" && (
        proiecte.length === 0 ? <EmptyState text="Nicio lucrare pentru acest client." /> : (
          <div style={{ overflowX: "auto" }}><table className="table">
            <thead><tr><th>Lucrare</th><th>Categorie</th><th>Stadiu</th><th>Execuție</th><th className="num">Valoare</th><th className="num">Cost realizat</th><th className="num">Marjă</th></tr></thead>
            <tbody>
              {proiecte.map((p) => {
                const val = p.valoareContract ?? p.valoareOferta ?? 0;
                const marja = val - (p.costRealizat || 0);
                return (
                  <tr key={p.id}>
                    <td className="cell-title">{p.nume}</td>
                    <td>{normCategorie(p.categorie)}</td>
                    <td><Badge tone={p.stadiu === "Finalizat" ? "ok" : p.stadiu === "Execuție" ? "accent" : "neutral"}>{p.stadiu}</Badge></td>
                    <td className="mono">{p.procentExecutie || 0}%</td>
                    <td className="num mono">{ron(val)}</td>
                    <td className="num mono">{ron(p.costRealizat)}</td>
                    <td className={`num mono ${marja < 0 ? "text-danger" : "text-ok"}`}>{ron(marja)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )
      )}

      {tab === "facturi" && (
        facturi.length === 0 ? <EmptyState text="Nicio factură emisă către acest client." /> : (
          <div style={{ overflowX: "auto" }}><table className="table">
            <thead><tr><th>Data</th><th>Partener</th><th>Lucrare</th><th className="num">Fără TVA</th><th className="num">Cu TVA</th><th>Status</th></tr></thead>
            <tbody>
              {facturi.map((f) => (
                <tr key={f.id}>
                  <td className="mono">{fmtDate(f.data)}</td>
                  <td>{f.partener}</td>
                  <td>{f.proiectId ? proiectNume(f.proiectId) : "—"}</td>
                  <td className="num mono">{ron(f.valoareFaraTva)}</td>
                  <td className="num mono">{ron((Number(f.valoareFaraTva) || 0) * (1 + (Number(f.cotaTva) || 0) / 100))}</td>
                  <td><Badge tone={f.status === "Încasată" ? "ok" : "warn"}>{f.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )
      )}

      {tab === "service" && (
        <div className="grid-2">
          <Card title="Garanții acordate">
            {garantii.length === 0 ? <EmptyState text="Nicio garanție." /> : (
              <ul className="request-list">{garantii.map((g) => (
                <li key={g.id}><div className="cell-sub">{g.termeni}</div><UrgencyBadge date={g.dataExpirare} /></li>
              ))}</ul>
            )}
          </Card>
          <Card title="Tichete de service">
            {tichete.length === 0 ? <EmptyState text="Niciun tichet." /> : (
              <ul className="request-list">{tichete.map((t) => (
                <li key={t.id}>
                  <div><div className="cell-title">{t.descriere}</div><div className="cell-sub mono">{fmtDate(t.dataCreare)}</div></div>
                  <Badge tone={t.status === "Rezolvat" ? "ok" : t.status === "În lucru" ? "warn" : "danger"}>{t.status}</Badge>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function ClientForm({ client, onSave, onCancel }) {
  const [f, setF] = useState(client);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Nume client"><input required value={f.nume} onChange={set("nume")} /></Field>
      <Field label="Contact"><input value={f.contact} onChange={set("contact")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function TicketForm({ clienti, onSave, onCancel }) {
  const [f, setF] = useState({ clientId: "", descriere: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (f.clientId && f.descriere) onSave(f); }}>
      <Field label="Client">
        <select required value={f.clientId} onChange={set("clientId")}>
          <option value="">Alege client…</option>
          {clienti.map((c) => <option key={c.id} value={c.id}>{c.nume}</option>)}
        </select>
      </Field>
      <Field label="Descriere solicitare"><textarea required rows={3} value={f.descriere} onChange={set("descriere")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Creează tichet</Button>
      </div>
    </form>
  );
}

/* =========================================================================
   MODULE: GESTIUNE FINANCIARĂ (facturi + TVA)
   ========================================================================= */


/* =========================================================================
   FINANCIAR — secțiuni noi: taxe și ANAF, parteneri și solduri (fișă analitică),
   cheltuieli administrative/protocol, comparație deviz ofertă vs. final vs. facturat
   Date noi (create la prima utilizare): obligatiiFiscale, datoriiAnaf, furnizori,
   miscariPartener, cheltuieliAdm. Toate se citesc cu `|| []`.
   ========================================================================= */

const ron2 = (n) => new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayStr = () => new Date().toISOString().slice(0, 10);
const fvTotal = (f) => (Number(f.valoareFaraTva) || 0) * (1 + (Number(f.cotaTva) || 0) / 100);
const normTxt = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/* ----------------------------- Taxe, ANAF, eșalonare ----------------------------- */

const TIPURI_OBLIGATIE = ["TVA", "Impozit pe profit / micro", "Impozite pe salarii și contribuții", "Taxe și impozite locale", "Alte obligații"];
const TIPURI_DATORIE_ANAF = ["TVA", "Impozit pe profit / micro", "Salarii și contribuții", "Taxe locale", "Alte datorii"];
const statusObligatie = (o) => (o.platita ? "Plătită" : o.scadenta && o.scadenta < todayStr() ? "Restantă" : "De plată");

function addMonthsStr(dateStr, i) {
  const [y, m, d] = (dateStr || todayStr()).split("-").map(Number);
  const base = new Date(y, m - 1 + i, 1);
  const dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d || 1, dim));
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

// Calendar de rate: "capital" = rate egale de capital + dobândă pe sold; "anuitate" = rată lunară constantă.
function planEsalonare({ suma, nrRate, dobandaAnuala, tipRata, dataStart }) {
  const n = Math.max(1, Math.round(Number(nrRate) || 1));
  const r = (Number(dobandaAnuala) || 0) / 100 / 12;
  const S = Number(suma) || 0;
  const rate = [];
  let sold = S;
  for (let i = 1; i <= n; i++) {
    const dobanda = sold * r;
    let principal = tipRata === "anuitate" && r > 0 ? (S * r) / (1 - Math.pow(1 + r, -n)) - dobanda : S / n;
    if (i === n) principal = sold;
    rate.push({ nr: i, scadenta: addMonthsStr(dataStart, i), principal: round2(principal), dobanda: round2(dobanda), platita: false });
    sold -= principal;
  }
  return rate;
}

function ramasDatorie(dt) {
  if (dt.esalonare) return dt.esalonare.rate.filter((r) => !r.platita).reduce((s, r) => s + r.principal + r.dobanda, 0);
  return (Number(dt.principal) || 0) + (Number(dt.accesorii) || 0);
}

function lunaDintre(dataStr) {
  if (!dataStr) return null;
  const a = new Date(dataStr + "T00:00:00"), b = new Date();
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function ObligatieForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Tip obligație"><select value={f.tip} onChange={set("tip")}>{TIPURI_OBLIGATIE.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Perioada / referință"><input value={f.perioada} onChange={set("perioada")} placeholder="ex: octombrie 2026" /></Field>
      <Field label="Scadență"><input type="date" required value={f.scadenta} onChange={set("scadenta")} /></Field>
      <Field label="Sumă (RON)"><input type="number" step="any" required value={f.suma} onChange={set("suma")} /></Field>
      <Field label="Observații" wide><input value={f.observatii || ""} onChange={set("observatii")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function DatorieAnafForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Descriere" wide><input required value={f.descriere} onChange={set("descriere")} placeholder="ex: TVA restant septembrie 2026" /></Field>
      <Field label="Tip datorie"><select value={f.tip} onChange={set("tip")}>{TIPURI_DATORIE_ANAF.map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Data de la care e restantă" hint="Folosită pentru eligibilitatea la eșalonarea simplificată"><input type="date" value={f.dataRestanta || ""} onChange={set("dataRestanta")} /></Field>
      <Field label="Sumă principală (RON)"><input type="number" step="any" required value={f.principal} onChange={set("principal")} /></Field>
      <Field label="Dobânzi și penalități (RON)"><input type="number" step="any" value={f.accesorii} onChange={set("accesorii")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function EsalonareSimulator({ datorie, onSave, onCancel }) {
  const existent = datorie.esalonare;
  const total = (Number(datorie.principal) || 0) + (Number(datorie.accesorii) || 0);
  const [tip, setTip] = useState(existent?.tip || (total <= 400000 ? "simplificata" : "clasica"));
  const [nrRate, setNrRate] = useState(existent?.nrRate || 12);
  const [dobanda, setDobanda] = useState(existent?.dobandaAnuala ?? 0);
  const [tipRata, setTipRata] = useState(existent?.tipRata || "capital");
  const [dataStart, setDataStart] = useState(existent?.dataStart || todayStr());
  const maxRate = tip === "simplificata" ? 12 : 60;
  const nr = Math.min(Math.max(1, Math.round(Number(nrRate) || 1)), maxRate);
  const rate = planEsalonare({ suma: total, nrRate: nr, dobandaAnuala: dobanda, tipRata, dataStart });
  const totDob = rate.reduce((s, r) => s + r.dobanda, 0);
  const variante = [6, 12, 24, 36, 48, 60].filter((n) => n <= maxRate).map((n) => {
    const rr = planEsalonare({ suma: total, nrRate: n, dobandaAnuala: dobanda, tipRata, dataStart });
    return { n, prima: rr[0].principal + rr[0].dobanda, dobanda: rr.reduce((s, r) => s + r.dobanda, 0) };
  });

  return (
    <div className="stack-md">
      <div className="hint-block"><strong>{datorie.descriere}</strong> — sumă de eșalonat: <strong className="mono">{ron2(total)}</strong></div>
      <div className="form-grid">
        <Field label="Tip eșalonare">
          <select value={tip} onChange={(e) => { setTip(e.target.value); if (e.target.value === "simplificata" && nrRate > 12) setNrRate(12); }}>
            <option value="simplificata">Simplificată (max. 12 luni, fără garanții)</option>
            <option value="clasica">Clasică (max. 5 ani, cu garanții)</option>
          </select>
        </Field>
        <Field label={`Număr de rate (max. ${maxRate})`}><input type="number" min="1" max={maxRate} value={nrRate} onChange={(e) => setNrRate(e.target.value)} /></Field>
        <Field label="Dobândă anuală (%)" hint="Introdu dobânda comunicată de ANAF — nu e preluată automat"><input type="number" step="any" min="0" value={dobanda} onChange={(e) => setDobanda(e.target.value)} /></Field>
        <Field label="Tip rate">
          <select value={tipRata} onChange={(e) => setTipRata(e.target.value)}>
            <option value="capital">Capital egal + dobândă pe sold</option>
            <option value="anuitate">Rată lunară constantă</option>
          </select>
        </Field>
        <Field label="Data de la care se calculează"><input type="date" value={dataStart} onChange={(e) => setDataStart(e.target.value)} /></Field>
      </div>
      {tip === "simplificata" && total > 400000 && <div className="hint-block" style={{ color: "var(--danger)" }}>Suma depășește plafonul de 400.000 lei pentru eșalonarea simplificată — pentru acest nivel se aplică eșalonarea clasică.</div>}
      {Number(dobanda) === 0 && <div className="hint-block" style={{ color: "var(--warn)" }}>Dobânda e 0%: calendarul de mai jos nu include dobânzi. Completează rata comunicată de ANAF ca să vezi costul real.</div>}

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th className="num">Nr. rate</th><th className="num">Prima rată</th><th className="num">Total dobânzi</th><th className="num">Total de plătit</th></tr></thead>
          <tbody>
            {variante.map((v) => (
              <tr key={v.n} style={{ background: v.n === nr ? "var(--signal-soft)" : undefined }}>
                <td className="num mono">{v.n}</td><td className="num mono">{ron2(v.prima)}</td><td className="num mono">{ron2(v.dobanda)}</td><td className="num mono">{ron2(total + v.dobanda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        <table className="table">
          <thead><tr><th>Rata</th><th>Scadență</th><th className="num">Capital</th><th className="num">Dobândă</th><th className="num">Total rată</th></tr></thead>
          <tbody>
            {rate.map((r) => (
              <tr key={r.nr}><td className="mono">{r.nr}</td><td className="mono">{fmtDate(r.scadenta)}</td><td className="num mono">{ron2(r.principal)}</td><td className="num mono">{ron2(r.dobanda)}</td><td className="num mono">{ron2(r.principal + r.dobanda)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint-block">Total dobânzi: <strong className="mono">{ron2(totDob)}</strong> · Total de plătit: <strong className="mono">{ron2(total + totDob)}</strong></div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="button" onClick={() => onSave({ tip, nrRate: nr, dobandaAnuala: Number(dobanda) || 0, tipRata, dataStart, suma: total, rate })}>Salvează planul la această datorie</Button>
      </div>
    </div>
  );
}

function FinanciarTaxe() {
  const { data, update } = useData();
  const toast = useToast();
  const [oblModal, setOblModal] = useState(null);
  const [datModal, setDatModal] = useState(null);
  const [simId, setSimId] = useState(null);
  const obligatii = [...(data.obligatiiFiscale || [])].sort((a, b) => (a.scadenta || "").localeCompare(b.scadenta || ""));
  const datorii = data.datoriiAnaf || [];
  const azi = todayStr();
  const peste30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const restante = obligatii.filter((o) => statusObligatie(o) === "Restantă").reduce((s, o) => s + (Number(o.suma) || 0), 0);
  const deplata30 = obligatii.filter((o) => !o.platita && o.scadenta >= azi && o.scadenta <= peste30).reduce((s, o) => s + (Number(o.suma) || 0), 0);
  const totalAnaf = datorii.reduce((s, d) => s + ramasDatorie(d), 0);
  const simDat = datorii.find((d) => d.id === simId);

  const upsert = (key, item, mapFn) => update((d) => {
    d[key] = d[key] || [];
    if (item.id) d[key] = d[key].map((x) => (x.id === item.id ? mapFn(item) : x));
    else d[key].push({ ...mapFn(item), id: uid() });
    return d;
  });
  function saveObl(o) { upsert("obligatiiFiscale", o, (x) => ({ ...x, suma: Number(x.suma) || 0 })); toast("Obligație salvată."); setOblModal(null); }
  function toggleObl(id) {
    update((d) => { const o = (d.obligatiiFiscale || []).find((x) => x.id === id); if (o) { o.platita = !o.platita; o.dataPlata = o.platita ? todayStr() : ""; } return d; });
  }
  function removeObl(id) { update((d) => { d.obligatiiFiscale = (d.obligatiiFiscale || []).filter((x) => x.id !== id); return d; }); toast("Obligație ștearsă.", "warn"); }
  function saveDat(x) { upsert("datoriiAnaf", x, (y) => ({ ...y, principal: Number(y.principal) || 0, accesorii: Number(y.accesorii) || 0 })); toast("Datorie salvată."); setDatModal(null); }
  function removeDat(id) { update((d) => { d.datoriiAnaf = (d.datoriiAnaf || []).filter((x) => x.id !== id); return d; }); toast("Datorie ștearsă.", "warn"); }
  function saveEsalonare(plan) {
    update((d) => { const x = (d.datoriiAnaf || []).find((y) => y.id === simId); if (x) x.esalonare = plan; return d; });
    toast("Plan de eșalonare salvat."); setSimId(null);
  }
  function removeEsalonare(id) { update((d) => { const x = (d.datoriiAnaf || []).find((y) => y.id === id); if (x) delete x.esalonare; return d; }); toast("Planul de eșalonare a fost eliminat.", "warn"); }
  function toggleRata(datId, nr) {
    update((d) => { const x = (d.datoriiAnaf || []).find((y) => y.id === datId); const r = x?.esalonare?.rate.find((z) => z.nr === nr); if (r) r.platita = !r.platita; return d; });
  }

  return (
    <div className="stack-lg">
      <div className="grid-3">
        <Card><div className="kpi-label">Obligații restante</div><div className={`kpi-value mono ${restante > 0 ? "text-danger" : ""}`}>{ron(restante)}</div></Card>
        <Card><div className="kpi-label">De plătit în 30 de zile</div><div className="kpi-value mono">{ron(deplata30)}</div></Card>
        <Card><div className="kpi-label">Datorii ANAF rămase</div><div className={`kpi-value mono ${totalAnaf > 0 ? "text-danger" : ""}`}>{ron(totalAnaf)}</div></Card>
      </div>

      <Card title="Taxe și impozite — obligații și scadențe" action={<Button size="sm" onClick={() => setOblModal({ tip: TIPURI_OBLIGATIE[0], perioada: "", scadenta: "", suma: "", observatii: "" })}><IconPlus size={14} /> Obligație nouă</Button>}>
        {obligatii.length === 0 ? <EmptyState text="Nicio obligație înregistrată. Adaugă TVA, impozite, contribuții sau taxe locale cu scadența lor." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Tip</th><th>Perioadă</th><th>Scadență</th><th className="num">Sumă</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {obligatii.map((o) => {
                  const st = statusObligatie(o);
                  return (
                    <tr key={o.id}>
                      <td><div className="cell-title">{o.tip}</div>{o.observatii && <div className="cell-sub">{o.observatii}</div>}</td>
                      <td>{o.perioada}</td>
                      <td className="mono">{fmtDate(o.scadenta)}</td>
                      <td className="num mono">{ron2(o.suma)}</td>
                      <td><button className="badge-btn" title="Marchează plătită / neplătită" onClick={() => toggleObl(o.id)}><Badge tone={st === "Plătită" ? "ok" : st === "Restantă" ? "danger" : "warn"}>{st}</Badge></button></td>
                      <td className="actions">
                        <IconButton title="Editează" onClick={() => setOblModal(o)}><IconEdit size={15} /></IconButton>
                        <ConfirmDelete onConfirm={() => removeObl(o.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Datorii către ANAF și eșalonare" action={<Button size="sm" onClick={() => setDatModal({ descriere: "", tip: TIPURI_DATORIE_ANAF[0], principal: "", accesorii: 0, dataRestanta: "" })}><IconPlus size={14} /> Datorie nouă</Button>}>
        {datorii.length === 0 ? <EmptyState text="Nicio datorie către ANAF înregistrată." /> : (
          <div className="stack-md">
            {datorii.map((dt) => {
              const total = (Number(dt.principal) || 0) + (Number(dt.accesorii) || 0);
              const luni = lunaDintre(dt.dataRestanta);
              const simplificata = total <= 400000 && luni !== null && luni <= 12;
              return (
                <div key={dt.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14 }} className="stack-md">
                  <div className="section-toolbar">
                    <div>
                      <div className="cell-title">{dt.descriere} <Badge tone="neutral">{dt.tip}</Badge></div>
                      <div className="cell-sub mono">principal {ron2(dt.principal)} + dobânzi/penalități {ron2(dt.accesorii)}{dt.dataRestanta ? ` · restantă din ${fmtDate(dt.dataRestanta)}` : ""}</div>
                    </div>
                    <div className="btn-row">
                      <Button size="sm" onClick={() => setSimId(dt.id)}>{dt.esalonare ? "Modifică eșalonarea" : "Simulează eșalonare"}</Button>
                      <IconButton title="Editează" onClick={() => setDatModal(dt)}><IconEdit size={15} /></IconButton>
                      <ConfirmDelete onConfirm={() => removeDat(dt.id)} />
                    </div>
                  </div>
                  <div className="hint-block">Rămas de plătit: <strong className={`mono ${ramasDatorie(dt) > 0 ? "text-danger" : "text-ok"}`}>{ron2(ramasDatorie(dt))}</strong></div>
                  {!dt.esalonare && (
                    <div className="cell-sub">
                      {luni === null ? "Completează data restanței ca să vezi ce tip de eșalonare se potrivește." : simplificata
                        ? "Pare eligibilă pentru eșalonarea simplificată (sub 400.000 lei, restanță de maximum 12 luni): până la 12 rate, fără garanții."
                        : "Nu se încadrează în eșalonarea simplificată (peste 400.000 lei sau restanță mai veche de 12 luni): se aplică eșalonarea clasică, până la 5 ani, cu garanții sau fideiusiune."}
                    </div>
                  )}
                  {dt.esalonare && (
                    <div className="stack-md">
                      <div className="cell-sub">Eșalonare {dt.esalonare.tip === "simplificata" ? "simplificată" : "clasică"} · {dt.esalonare.nrRate} rate · dobândă {dt.esalonare.dobandaAnuala}% / an <button className="link-btn danger" onClick={() => removeEsalonare(dt.id)}>Elimină planul</button></div>
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        <table className="table">
                          <thead><tr><th>Rata</th><th>Scadență</th><th className="num">Capital</th><th className="num">Dobândă</th><th className="num">Total</th><th>Plătită</th></tr></thead>
                          <tbody>
                            {dt.esalonare.rate.map((r) => (
                              <tr key={r.nr}>
                                <td className="mono">{r.nr}</td>
                                <td className="mono">{fmtDate(r.scadenta)}{!r.platita && r.scadenta < azi ? <Badge tone="danger"> restantă</Badge> : null}</td>
                                <td className="num mono">{ron2(r.principal)}</td><td className="num mono">{ron2(r.dobanda)}</td><td className="num mono">{ron2(r.principal + r.dobanda)}</td>
                                <td><input type="checkbox" checked={!!r.platita} onChange={() => toggleRata(dt.id, r.nr)} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <details style={{ marginTop: 12 }}>
          <summary className="cell-sub" style={{ cursor: "pointer" }}>Cum funcționează eșalonarea la plată (orientativ)</summary>
          <ul style={{ margin: "8px 0 0 18px" }}>
            <li className="cell-sub">Simplificată: pentru persoane juridice, datorii de până la 400.000 lei, cu durata maximă de 12 luni, fără garanții; firma trebuie să fie înființată de cel puțin 12 luni, iar datoriile să fie vechi de maximum 12 luni la data cererii.</li>
            <li className="cell-sub">Clasică: fără plafon la valoarea datoriilor, până la 5 ani, cu garanții sau contract de fideiusiune.</li>
            <li className="cell-sub">Dobânda, calculul ratelor și efectul asupra penalităților nu sunt preluate din sursă — verifică-le pe anaf.ro sau cu contabilul înainte de depunerea cererii. Simulatorul e doar o estimare.</li>
            <li className="cell-sub">Sursă: comunicat ANAF din 13.01.2026, reprodus de <a href="https://www.contzilla.ro/anaf-noutati-2026-esalonare-clasica-si-esalonare-simplificata/" target="_blank" rel="noreferrer">contzilla.ro</a>. Nu înlocuiește consultanța fiscală.</li>
          </ul>
        </details>
      </Card>

      <Modal open={!!oblModal} onClose={() => setOblModal(null)} title={oblModal?.id ? "Editează obligația" : "Obligație fiscală nouă"}>
        {oblModal && <ObligatieForm initial={oblModal} onSave={saveObl} onCancel={() => setOblModal(null)} />}
      </Modal>
      <Modal open={!!datModal} onClose={() => setDatModal(null)} title={datModal?.id ? "Editează datoria" : "Datorie nouă către ANAF"}>
        {datModal && <DatorieAnafForm initial={datModal} onSave={saveDat} onCancel={() => setDatModal(null)} />}
      </Modal>
      <Modal open={!!simDat} onClose={() => setSimId(null)} title="Simulator eșalonare" wide>
        {simDat && <EsalonareSimulator datorie={simDat} onSave={saveEsalonare} onCancel={() => setSimId(null)} />}
      </Modal>
    </div>
  );
}

/* ----------------------------- Parteneri, solduri, fișă analitică ----------------------------- */

const listaParteneri = (data) => [
  ...data.clienti.map((c) => ({ ...c, tip: "client" })),
  ...(data.furnizori || []).map((s) => ({ ...s, tip: "furnizor" })),
];

// Asocierea unei facturi cu un partener: id salvat → clientul proiectului → nume (exact sau prefix).
function matchPartener(f, parteneri, proiecte) {
  if (f.partenerId) { const m = parteneri.find((p) => p.id === f.partenerId); if (m) return m; }
  if (f.tip === "emisa" && f.proiectId) {
    const pr = proiecte.find((p) => p.id === f.proiectId);
    const m = pr && parteneri.find((p) => p.tip === "client" && p.id === pr.clientId);
    if (m) return m;
  }
  const n = normTxt(f.partener);
  if (!n) return null;
  const cand = parteneri.filter((p) => p.tip === (f.tip === "emisa" ? "client" : "furnizor"));
  const exact = cand.find((p) => normTxt(p.nume) === n);
  if (exact) return exact;
  if (n.length < 5) return null;
  return cand.find((p) => { const pn = normTxt(p.nume); return pn.length >= 5 && (pn.startsWith(n) || n.startsWith(pn)); }) || null;
}

const MISCARI = {
  sold_initial: { sign: 1 },
  plata: { sign: -1 },
  ajust_plus: { sign: 1 },
  ajust_minus: { sign: -1 },
};
const etichetaMiscare = (tip, kind) => ({
  sold_initial: kind === "client" ? "Sold inițial (ne datorează)" : "Sold inițial (le datorăm)",
  plata: kind === "client" ? "Încasare" : "Plată",
  ajust_plus: "Ajustare în plus",
  ajust_minus: "Ajustare în minus / stornare",
}[tip]);

function fisaPartener(data, p) {
  const parteneri = listaParteneri(data);
  const proiectNume = (id) => data.proiecte.find((x) => x.id === id)?.nume;
  const facturi = data.facturi.filter((f) => f.tip === (p.tip === "client" ? "emisa" : "primita") && matchPartener(f, parteneri, data.proiecte)?.id === p.id)
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  const linii = [];
  facturi.forEach((f) => {
    linii.push({ key: "f" + f.id, data: f.data, rang: 1, doc: "Factură", expl: proiectNume(f.proiectId) || f.partener, plus: fvTotal(f), minus: 0 });
    if (p.tip === "client" && f.status === "Încasată") linii.push({ key: "i" + f.id, data: f.data, rang: 2, doc: "Încasare (marcată pe factură)", expl: "Factura e marcată „Încasată”", plus: 0, minus: fvTotal(f), auto: true });
  });
  (data.miscariPartener || []).filter((m) => m.partenerId === p.id).forEach((m) => {
    const v = MISCARI[m.tip].sign * (Number(m.suma) || 0);
    linii.push({ key: "m" + m.id, data: m.data, rang: m.tip === "sold_initial" ? 0 : 1, doc: etichetaMiscare(m.tip, p.tip), expl: [m.document, m.explicatii].filter(Boolean).join(" · "), plus: v > 0 ? v : 0, minus: v < 0 ? -v : 0, miscare: m });
  });
  linii.sort((a, b) => (a.data || "").localeCompare(b.data || "") || a.rang - b.rang);
  let sold = 0;
  linii.forEach((l) => { sold += l.plus - l.minus; l.sold = sold; });
  return {
    linii, facturi, sold,
    totalFacturat: facturi.reduce((s, f) => s + fvTotal(f), 0),
    totalAchitat: linii.filter((l) => l.minus > 0).reduce((s, l) => s + l.minus, 0),
    ultima: linii.length ? linii[linii.length - 1].data : "",
  };
}

function PartenerForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const nou = !initial.id;
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      {nou && (
        <Field label="Tip partener">
          <select value={f.tip} onChange={set("tip")}><option value="client">Client</option><option value="furnizor">Furnizor</option></select>
        </Field>
      )}
      <Field label="Denumire" wide><input required value={f.nume} onChange={set("nume")} placeholder="ex: Romstal" /></Field>
      <Field label="CUI"><input value={f.cui || ""} onChange={set("cui")} /></Field>
      <Field label="Contact"><input value={f.contact || ""} onChange={set("contact")} /></Field>
      {nou && (
        <>
          <Field label="Sold inițial (RON, opțional)" hint={f.tip === "client" ? "Cât ne datorează acum" : "Cât le datorăm acum"}><input type="number" step="any" value={f.soldInitial} onChange={set("soldInitial")} /></Field>
          <Field label="Sold la data de"><input type="date" value={f.dataSold} onChange={set("dataSold")} /></Field>
        </>
      )}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function MiscareForm({ initial, kind, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Tip mișcare">
        <select value={f.tip} onChange={set("tip")}>{Object.keys(MISCARI).map((t) => <option key={t} value={t}>{etichetaMiscare(t, kind)}</option>)}</select>
      </Field>
      <Field label="Data"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Sumă (RON)"><input type="number" step="any" required value={f.suma} onChange={set("suma")} /></Field>
      <Field label="Document" hint="ex. chitanță, ordin de plată, extras"><input value={f.document || ""} onChange={set("document")} /></Field>
      <Field label="Explicații" wide><input value={f.explicatii || ""} onChange={set("explicatii")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function FisaAnalitica({ partener, data, actions }) {
  const [tab, setTab] = useState("cronologie");
  const fisa = fisaPartener(data, partener);
  const kind = partener.tip;
  const proiecte = kind === "client" ? data.proiecte.filter((p) => p.clientId === partener.id) : [];
  const documente = partener.documente || [];
  const etSold = fisa.sold > 0.005 ? (kind === "client" ? "de încasat" : "de plătit") : fisa.sold < -0.005 ? (kind === "client" ? "încasat în plus" : "plătit în avans") : "la zi";
  const TABS = [
    { key: "cronologie", label: "Cronologie și sold" },
    { key: "facturi", label: `Facturi (${fisa.facturi.length})` },
    { key: "documente", label: `Contracte și acte (${documente.length})` },
    ...(kind === "client" ? [{ key: "lucrari", label: `Lucrări (${proiecte.length})` }] : []),
  ];
  return (
    <div className="stack-md">
      <div className="grid-4 fisa-kpi">
        <Card><div className="kpi-label">Facturat (cu TVA)</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron2(fisa.totalFacturat)}</div></Card>
        <Card><div className="kpi-label">{kind === "client" ? "Încasat" : "Plătit"}</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron2(fisa.totalAchitat)}</div></Card>
        <Card><div className="kpi-label">Sold</div><div className={`kpi-value mono ${fisa.sold > 0.005 ? "text-danger" : "text-ok"}`} style={{ fontSize: 20 }}>{ron2(Math.abs(fisa.sold))}</div><div className="kpi-sub">{etSold}</div></Card>
        <Card><div className="kpi-label">Facturi</div><div className="kpi-value" style={{ fontSize: 20 }}>{fisa.facturi.length}</div></Card>
      </div>
      {(partener.cui || partener.contact) && <div className="cell-sub">{partener.cui ? `CUI ${partener.cui}` : ""}{partener.cui && partener.contact ? " · " : ""}{partener.contact}</div>}
      <div className="tab-row">
        {TABS.map((t) => <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {tab === "cronologie" && (
        <div className="stack-md">
          <div className="section-toolbar">
            <p className="section-intro">Facturile apar automat. Adaugă manual solduri inițiale, {kind === "client" ? "încasări" : "plăți"} și ajustări. Facturile emise marcate „Încasată” se scad automat — nu le mai înregistra și aici.</p>
            <Button size="sm" onClick={actions.miscareNoua}><IconPlus size={14} /> Mișcare nouă</Button>
          </div>
          {fisa.linii.length === 0 ? <EmptyState text="Nicio mișcare încă." /> : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Data</th><th>Document</th><th className="num">Crește soldul</th><th className="num">Scade soldul</th><th className="num">Sold</th><th></th></tr></thead>
                <tbody>
                  {fisa.linii.map((l) => (
                    <tr key={l.key}>
                      <td className="mono">{fmtDate(l.data)}</td>
                      <td>{l.doc}{l.expl ? <div className="cell-sub">{l.expl}</div> : null}</td>
                      <td className="num mono">{l.plus ? ron2(l.plus) : ""}</td>
                      <td className="num mono">{l.minus ? ron2(l.minus) : ""}</td>
                      <td className={`num mono ${l.sold > 0.005 ? "text-danger" : "text-ok"}`}>{ron2(l.sold)}</td>
                      <td className="actions">
                        {l.miscare && <>
                          <IconButton title="Editează" onClick={() => actions.editMiscare(l.miscare)}><IconEdit size={15} /></IconButton>
                          <ConfirmDelete onConfirm={() => actions.stergeMiscare(l.miscare.id)} />
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "facturi" && (
        fisa.facturi.length === 0 ? <EmptyState text="Nicio factură asociată acestui partener." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Data</th><th>Lucrare</th><th className="num">Fără TVA</th><th className="num">Cu TVA</th><th>Status</th></tr></thead>
              <tbody>
                {[...fisa.facturi].reverse().map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{fmtDate(f.data)}</td>
                    <td>{data.proiecte.find((x) => x.id === f.proiectId)?.nume || "—"}</td>
                    <td className="num mono">{ron2(f.valoareFaraTva)}</td>
                    <td className="num mono">{ron2(fvTotal(f))}</td>
                    <td><Badge tone={f.status === "Încasată" || f.status === "Înregistrată" ? "ok" : "warn"}>{f.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "documente" && <DocumenteClientList documente={documente} onAdaugaDocument={actions.documentNou} onSterge={actions.stergeDocument} eticheta={kind === "client" ? "client" : "furnizor"} />}

      {tab === "lucrari" && (
        proiecte.length === 0 ? <EmptyState text="Nicio lucrare pentru acest client." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Lucrare</th><th>Stadiu</th><th className="num">Ofertă</th><th className="num">Final</th><th className="num">Facturat</th></tr></thead>
              <tbody>
                {proiecte.map((p) => {
                  const s = situatieProiect(data, p);
                  return (
                    <tr key={p.id}>
                      <td className="cell-title">{p.nume}</td>
                      <td><Badge tone={p.stadiu === "Finalizat" ? "ok" : p.stadiu === "Execuție" ? "accent" : "neutral"}>{p.stadiu}</Badge></td>
                      <td className="num mono">{ron(s.oferta)}</td>
                      <td className="num mono">{s.final != null ? ron(s.final) : "—"}</td>
                      <td className="num mono">{ron(s.facturat)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function FinanciarParteneri() {
  const { data, update } = useData();
  const toast = useToast();
  const [filtru, setFiltru] = useState("toti");
  const [fisaId, setFisaId] = useState(null);
  const [partenerModal, setPartenerModal] = useState(null);
  const [miscareForm, setMiscareForm] = useState(null);
  const [docModal, setDocModal] = useState(false);

  // Fișă automată pentru fiecare furnizor care apare pe facturi primite.
  useEffect(() => {
    const parteneri = listaParteneri(data);
    const lipsa = new Map();
    data.facturi.forEach((f) => {
      if (f.tip === "primita" && (f.partener || "").trim() && !matchPartener(f, parteneri, data.proiecte)) {
        const k = normTxt(f.partener);
        if (!lipsa.has(k)) lipsa.set(k, f.partener.trim());
      }
    });
    if (lipsa.size === 0) return;
    update((d) => {
      d.furnizori = d.furnizori || [];
      lipsa.forEach((nume, k) => {
        if (!d.furnizori.some((x) => normTxt(x.nume) === k)) d.furnizori.push({ id: uid(), nume, cui: "", contact: "", documente: [] });
      });
      return d;
    });
  }, [data.facturi, data.furnizori]);

  const parteneri = listaParteneri(data);
  const randuri = parteneri.map((p) => ({ p, fisa: fisaPartener(data, p) }))
    .filter(({ p, fisa }) => filtru === "toti" || (filtru === "sold" ? Math.abs(fisa.sold) > 0.005 : p.tip === filtru))
    .sort((a, b) => Math.abs(b.fisa.sold) - Math.abs(a.fisa.sold) || a.p.nume.localeCompare(b.p.nume));
  const deIncasat = parteneri.filter((p) => p.tip === "client").reduce((s, p) => s + Math.max(0, fisaPartener(data, p).sold), 0);
  const dePlatit = parteneri.filter((p) => p.tip === "furnizor").reduce((s, p) => s + Math.max(0, fisaPartener(data, p).sold), 0);
  const neasociate = data.facturi.filter((f) => f.tip === "emisa" && !matchPartener(f, parteneri, data.proiecte));
  const fisaP = parteneri.find((p) => p.id === fisaId);

  function savePartener(f) {
    update((d) => {
      if (f.id) {
        d.furnizori = (d.furnizori || []).map((x) => (x.id === f.id ? { ...x, nume: f.nume.trim(), cui: f.cui || "", contact: f.contact || "" } : x));
        return d;
      }
      const id = uid();
      if (f.tip === "client") d.clienti.push({ id, nume: f.nume.trim(), contact: f.contact || "", cui: f.cui || "" });
      else { d.furnizori = d.furnizori || []; d.furnizori.push({ id, nume: f.nume.trim(), cui: f.cui || "", contact: f.contact || "", documente: [] }); }
      const sold = Number(f.soldInitial);
      if (f.soldInitial !== "" && sold) {
        d.miscariPartener = d.miscariPartener || [];
        d.miscariPartener.push({ id: uid(), partenerId: id, tip: "sold_initial", data: f.dataSold || todayStr(), suma: sold, document: "Sold inițial", explicatii: "" });
      }
      return d;
    });
    toast(f.id ? "Partener actualizat." : "Partener adăugat.");
    setPartenerModal(null);
  }
  function removeFurnizor(id) {
    update((d) => { d.furnizori = (d.furnizori || []).filter((x) => x.id !== id); d.miscariPartener = (d.miscariPartener || []).filter((m) => m.partenerId !== id); return d; });
    toast("Furnizor șters.", "warn");
  }
  function saveMiscare(m) {
    update((d) => {
      d.miscariPartener = d.miscariPartener || [];
      const clean = { ...m, suma: Number(m.suma) || 0, partenerId: fisaId };
      if (m.id) d.miscariPartener = d.miscariPartener.map((x) => (x.id === m.id ? clean : x));
      else d.miscariPartener.push({ ...clean, id: uid() });
      return d;
    });
    toast("Mișcare salvată."); setMiscareForm(null);
  }
  function removeMiscare(id) { update((d) => { d.miscariPartener = (d.miscariPartener || []).filter((m) => m.id !== id); return d; }); toast("Mișcare ștearsă.", "warn"); }
  function ownerList(d) { return fisaP.tip === "client" ? d.clienti : (d.furnizori = d.furnizori || []); }
  function addDoc(doc) {
    update((d) => { const o = ownerList(d).find((x) => x.id === fisaId); if (o) (o.documente = o.documente || []).push({ ...doc, id: uid(), dataAdaugare: todayStr() }); return d; });
    toast("Document salvat."); setDocModal(false);
  }
  function removeDoc(docId) {
    update((d) => { const o = ownerList(d).find((x) => x.id === fisaId); if (o) o.documente = (o.documente || []).filter((x) => x.id !== docId); return d; });
    toast("Document șters.", "warn");
  }
  function asociaFactura(facturaId, partenerId) {
    update((d) => { const f = d.facturi.find((x) => x.id === facturaId); if (f) f.partenerId = partenerId; return d; });
  }

  return (
    <div className="stack-lg">
      <div className="grid-3">
        <Card><div className="kpi-label">De încasat de la clienți</div><div className="kpi-value mono">{ron(deIncasat)}</div></Card>
        <Card><div className="kpi-label">De plătit furnizorilor</div><div className="kpi-value mono">{ron(dePlatit)}</div></Card>
        <Card><div className="kpi-label">Parteneri în evidență</div><div className="kpi-value">{parteneri.length}</div></Card>
      </div>

      <div className="section-toolbar">
        <p className="section-intro">Clienți și furnizori cu soldurile lor. Fișa analitică se generează automat din facturi, plus soldurile și plățile adăugate manual.</p>
        <div className="btn-row">
          <select value={filtru} onChange={(e) => setFiltru(e.target.value)}>
            <option value="toti">Toți partenerii</option><option value="client">Doar clienți</option><option value="furnizor">Doar furnizori</option><option value="sold">Doar cu sold</option>
          </select>
          <Button onClick={() => setPartenerModal({ tip: "furnizor", nume: "", cui: "", contact: "", soldInitial: "", dataSold: todayStr() })}><IconPlus size={15} /> Partener nou</Button>
        </div>
      </div>

      {neasociate.length > 0 && (
        <Card className="warn-card">
          <div className="stack-md">
            <div className="warn-card-inner"><IconAlert size={17} className="text-warn" /><span><strong>{neasociate.length}</strong> factură/facturi emise nu sunt asociate niciunui client — alege clientul ca să intre în fișa lui.</span></div>
            {neasociate.map((f) => (
              <div key={f.id} className="btn-row" style={{ flexWrap: "wrap" }}>
                <span className="cell-sub">{fmtDate(f.data)} · {f.partener || "fără partener"} · {ron2(fvTotal(f))}</span>
                <select value="" onChange={(e) => e.target.value && asociaFactura(f.id, e.target.value)}>
                  <option value="">Asociază cu…</option>
                  {data.clienti.map((c) => <option key={c.id} value={c.id}>{c.nume}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {randuri.length === 0 ? <EmptyState text="Niciun partener." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Partener</th><th>Tip</th><th className="num">Facturat</th><th className="num">Încasat / plătit</th><th className="num">Sold</th><th>Ultima mișcare</th><th></th></tr></thead>
              <tbody>
                {randuri.map(({ p, fisa }) => (
                  <tr key={p.id}>
                    <td><button className="link-btn" style={{ fontWeight: 600, textAlign: "left" }} onClick={() => setFisaId(p.id)}>{p.nume}</button></td>
                    <td><Badge tone={p.tip === "client" ? "accent" : "neutral"}>{p.tip === "client" ? "Client" : "Furnizor"}</Badge></td>
                    <td className="num mono">{ron2(fisa.totalFacturat)}</td>
                    <td className="num mono">{ron2(fisa.totalAchitat)}</td>
                    <td className={`num mono ${fisa.sold > 0.005 ? "text-danger" : "text-ok"}`}>{ron2(fisa.sold)}<div className="cell-sub">{fisa.sold > 0.005 ? (p.tip === "client" ? "de încasat" : "de plătit") : fisa.sold < -0.005 ? "avans" : ""}</div></td>
                    <td className="mono">{fisa.ultima ? fmtDate(fisa.ultima) : "—"}</td>
                    <td className="actions">
                      <Button size="sm" onClick={() => setFisaId(p.id)}>Fișă analitică</Button>
                      {p.tip === "furnizor" && <>
                        <IconButton title="Editează" onClick={() => setPartenerModal(p)}><IconEdit size={15} /></IconButton>
                        <ConfirmDelete title="Ștergi furnizorul și mișcările lui?" onConfirm={() => removeFurnizor(p.id)} />
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!fisaP} onClose={() => setFisaId(null)} title={`Fișă analitică — ${fisaP?.nume || ""}`} wide>
        {fisaP && (
          <FisaAnalitica
            partener={fisaP}
            data={data}
            actions={{
              miscareNoua: () => setMiscareForm({ tip: fisaP.tip === "client" ? "plata" : "plata", data: todayStr(), suma: "", document: "", explicatii: "" }),
              editMiscare: (m) => setMiscareForm(m),
              stergeMiscare: removeMiscare,
              documentNou: () => setDocModal(true),
              stergeDocument: removeDoc,
            }}
          />
        )}
      </Modal>
      <Modal open={!!partenerModal} onClose={() => setPartenerModal(null)} title={partenerModal?.id ? "Editează furnizorul" : "Partener nou"}>
        {partenerModal && <PartenerForm initial={partenerModal} onSave={savePartener} onCancel={() => setPartenerModal(null)} />}
      </Modal>
      <Modal open={!!miscareForm && !!fisaP} onClose={() => setMiscareForm(null)} title={miscareForm?.id ? "Editează mișcarea" : "Mișcare nouă"}>
        {miscareForm && fisaP && <MiscareForm initial={miscareForm} kind={fisaP.tip} onSave={saveMiscare} onCancel={() => setMiscareForm(null)} />}
      </Modal>
      <Modal open={docModal} onClose={() => setDocModal(false)} title="Adaugă document">
        <DocumentNouForm onSave={addDoc} onCancel={() => setDocModal(false)} />
      </Modal>
    </div>
  );
}

/* ----------------------------- Cheltuieli administrative și de protocol ----------------------------- */

const CATEGORII_CHELTUIALA = {
  Administrative: ["Chirie sediu", "Utilități", "Telefonie și internet", "Papetărie și consumabile birou", "Servicii contabilitate", "Taxe și comisioane bancare", "Software și abonamente", "Asigurări", "Alte administrative"],
  Protocol: ["Mese și evenimente cu clienți", "Cadouri", "Deplasări de protocol", "Alte cheltuieli de protocol"],
};
const DEDUCTIBILITATI = ["Deductibil integral", "Deductibil limitat", "Nedeductibil"];

function emptyCheltuiala() {
  return { id: null, data: todayStr(), grupa: "Administrative", categorie: CATEGORII_CHELTUIALA.Administrative[0], descriere: "", furnizor: "", document: "", suma: "", cotaTva: 19, deductibilitate: DEDUCTIBILITATI[0] };
}

function CheltuialaForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const schimbaGrupa = (e) => {
    const g = e.target.value;
    setF({ ...f, grupa: g, categorie: CATEGORII_CHELTUIALA[g][0], deductibilitate: g === "Protocol" ? "Deductibil limitat" : "Deductibil integral" });
  };
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Grupă"><select value={f.grupa} onChange={schimbaGrupa}>{Object.keys(CATEGORII_CHELTUIALA).map((g) => <option key={g}>{g}</option>)}</select></Field>
      <Field label="Categorie"><select value={f.categorie} onChange={set("categorie")}>{CATEGORII_CHELTUIALA[f.grupa].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Data"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Document (factură / bon)"><input value={f.document} onChange={set("document")} /></Field>
      <Field label="Descriere" wide><input required value={f.descriere} onChange={set("descriere")} /></Field>
      <Field label="Furnizor"><input value={f.furnizor} onChange={set("furnizor")} /></Field>
      <Field label="Valoare fără TVA (RON)"><input type="number" step="any" required value={f.suma} onChange={set("suma")} /></Field>
      <Field label="Cotă TVA (%)"><input type="number" step="any" value={f.cotaTva} onChange={set("cotaTva")} /></Field>
      <Field label="Deductibilitate fiscală" hint={f.grupa === "Protocol" ? "Protocolul e deductibil doar în limite legale — confirmă cu contabilul" : ""}>
        <select value={f.deductibilitate} onChange={set("deductibilitate")}>{DEDUCTIBILITATI.map((d) => <option key={d}>{d}</option>)}</select>
      </Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function FinanciarCheltuieli() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [luna, setLuna] = useState(currentMonthKey);
  const [grupa, setGrupa] = useState("");
  const toate = data.cheltuieliAdm || [];
  const luni = [...new Set(toate.map((c) => monthKey(c.data)))].sort().reverse();
  if (!luni.includes(currentMonthKey)) luni.unshift(currentMonthKey);
  const dinLuna = toate.filter((c) => monthKey(c.data) === luna);
  const lista = dinLuna.filter((c) => !grupa || c.grupa === grupa).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const sum = (arr) => arr.reduce((s, c) => s + (Number(c.suma) || 0), 0);
  const an = luna.slice(0, 4);
  const totalAn = sum(toate.filter((c) => (c.data || "").slice(0, 4) === an));
  const perCategorie = [...new Set(dinLuna.map((c) => c.categorie))].map((cat) => ({ cat, total: sum(dinLuna.filter((c) => c.categorie === cat)) })).sort((a, b) => b.total - a.total);

  function save(c) {
    update((d) => {
      d.cheltuieliAdm = d.cheltuieliAdm || [];
      const clean = { ...c, suma: Number(c.suma) || 0, cotaTva: Number(c.cotaTva) || 0 };
      if (c.id) d.cheltuieliAdm = d.cheltuieliAdm.map((x) => (x.id === c.id ? clean : x));
      else d.cheltuieliAdm.push({ ...clean, id: uid() });
      return d;
    });
    toast("Cheltuială salvată."); setModal(null);
  }
  function remove(id) { update((d) => { d.cheltuieliAdm = (d.cheltuieliAdm || []).filter((x) => x.id !== id); return d; }); toast("Cheltuială ștearsă.", "warn"); }

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Registru de cheltuieli administrative și de protocol, cu categorii și deductibilitate.</p>
        <div className="btn-row">
          <select value={luna} onChange={(e) => setLuna(e.target.value)}>{luni.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <select value={grupa} onChange={(e) => setGrupa(e.target.value)}><option value="">Toate grupele</option>{Object.keys(CATEGORII_CHELTUIALA).map((g) => <option key={g}>{g}</option>)}</select>
          <Button onClick={() => setModal(emptyCheltuiala())}><IconPlus size={15} /> Cheltuială nouă</Button>
        </div>
      </div>

      <div className="grid-4 fisa-kpi">
        <Card><div className="kpi-label">Administrative — {luna}</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(sum(dinLuna.filter((c) => c.grupa === "Administrative")))}</div></Card>
        <Card><div className="kpi-label">Protocol — {luna}</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(sum(dinLuna.filter((c) => c.grupa === "Protocol")))}</div></Card>
        <Card><div className="kpi-label">Total luna (fără TVA)</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(sum(dinLuna))}</div></Card>
        <Card><div className="kpi-label">Total {an}</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron(totalAn)}</div></Card>
      </div>

      <Card title={`Cheltuieli — ${luna}`}>
        {lista.length === 0 ? <EmptyState text="Nicio cheltuială în această lună." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Data</th><th>Categorie</th><th>Descriere</th><th>Deductibilitate</th><th className="num">Fără TVA</th><th className="num">TVA</th><th></th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{fmtDate(c.data)}</td>
                    <td><Badge tone={c.grupa === "Protocol" ? "warn" : "neutral"}>{c.grupa}</Badge><div className="cell-sub">{c.categorie}</div></td>
                    <td><div>{c.descriere}</div><div className="cell-sub">{[c.furnizor, c.document].filter(Boolean).join(" · ")}</div></td>
                    <td className="cell-sub">{c.deductibilitate}</td>
                    <td className="num mono">{ron2(c.suma)}</td>
                    <td className="num mono">{ron2((c.suma * c.cotaTva) / 100)}</td>
                    <td className="actions"><IconButton title="Editează" onClick={() => setModal(c)}><IconEdit size={15} /></IconButton><ConfirmDelete onConfirm={() => remove(c.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {perCategorie.length > 0 && (
        <Card title={`Pe categorii — ${luna}`}>
          <table className="table">
            <thead><tr><th>Categorie</th><th className="num">Total fără TVA</th></tr></thead>
            <tbody>{perCategorie.map((x) => <tr key={x.cat}><td>{x.cat}</td><td className="num mono">{ron2(x.total)}</td></tr>)}</tbody>
          </table>
        </Card>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează cheltuiala" : "Cheltuială nouă"}>
        {modal && <CheltuialaForm initial={modal} onSave={save} onCancel={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

/* ----------------------------- Deviz ofertă vs. final vs. facturat ----------------------------- */

const devizeDupaMoment = (p, moment) => (p.devize || []).filter((d) => d.moment === moment).sort((a, b) => (a.data || "").localeCompare(b.data || ""));

function situatieProiect(data, p, excludeFacturaId) {
  const ofertaDv = devizeDupaMoment(p, "Inițial (ofertă)").slice(-1)[0] || null;
  const finalDv = devizeDupaMoment(p, "Final").slice(-1)[0] || null;
  const supl = devizeDupaMoment(p, "Suplimentar").reduce((s, d) => s + totalDeviz(d), 0);
  const oferta = ofertaDv ? totalDeviz(ofertaDv) : Number(p.valoareOferta) || 0;
  const final = finalDv ? totalDeviz(finalDv) : null;
  const facturi = data.facturi.filter((f) => f.tip === "emisa" && f.proiectId === p.id && f.id !== excludeFacturaId);
  const facturat = facturi.reduce((s, f) => s + (Number(f.valoareFaraTva) || 0), 0);
  const ref = final != null ? final : (Number(p.valoareContract) || oferta + supl);
  const refLabel = final != null ? "devizul final" : p.valoareContract ? "valoarea contractului" : "oferta + suplimentare";
  return { ofertaDv, finalDv, oferta, supl, final, facturi, facturat, ref, refLabel, rest: ref - facturat };
}

function diferenteLinii(ofertaDv, finalDv) {
  const cheie = (l) => (l.cod || "").trim().toLowerCase() || normTxt(l.denumire);
  const agrega = (dv) => {
    const m = new Map();
    (dv?.linii || []).forEach((l) => {
      const k = cheie(l);
      const x = m.get(k) || { den: l.denumire, um: l.um, cant: 0, total: 0 };
      x.cant += Number(l.cantitate) || 0; x.total += totalLinie(l);
      m.set(k, x);
    });
    return m;
  };
  const O = agrega(ofertaDv), F = agrega(finalDv);
  const rows = [];
  new Set([...O.keys(), ...F.keys()]).forEach((k) => {
    const o = O.get(k), f = F.get(k);
    const delta = (f?.total || 0) - (o?.total || 0);
    const stare = !o ? "Adăugată" : !f ? "Eliminată" : Math.abs(delta) < 0.005 && Math.abs(o.cant - f.cant) < 0.0001 ? "Identică" : "Modificată";
    rows.push({ den: (f || o).den, um: (f || o).um, o, f, delta, stare });
  });
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function DetaliuComparatie({ proiect, data }) {
  const s = situatieProiect(data, proiect);
  const diffs = s.ofertaDv && s.finalDv ? diferenteLinii(s.ofertaDv, s.finalDv) : [];
  const perCat = CATEGORII_DEVIZ.map((cat) => {
    const t = (dv) => (dv?.linii || []).filter((l) => l.categorie === cat).reduce((x, l) => x + totalLinie(l), 0);
    return { cat, o: t(s.ofertaDv), f: t(s.finalDv) };
  });
  const tone = { "Adăugată": "warn", "Eliminată": "danger", "Modificată": "accent", "Identică": "ok" };
  return (
    <div className="stack-md">
      <div className="grid-4 fisa-kpi">
        <Card><div className="kpi-label">Ofertă</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron2(s.oferta)}</div></Card>
        <Card><div className="kpi-label">Final</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{s.final != null ? ron2(s.final) : "—"}</div></Card>
        <Card><div className="kpi-label">Facturat (fără TVA)</div><div className="kpi-value mono" style={{ fontSize: 20 }}>{ron2(s.facturat)}</div></Card>
        <Card><div className="kpi-label">Rămas de facturat</div><div className={`kpi-value mono ${s.rest < -0.5 ? "text-danger" : ""}`} style={{ fontSize: 20 }}>{ron2(s.rest)}</div><div className="kpi-sub">față de {s.refLabel}</div></Card>
      </div>
      {s.supl > 0 && <div className="cell-sub">Devize suplimentare: {ron2(s.supl)} (nu sunt incluse în comparația ofertă vs. final de mai jos).</div>}

      {!s.ofertaDv && <div className="hint-block" style={{ color: "var(--warn)" }}>Lipsește devizul inițial (ofertă) — pentru comparație pe linii adaugă-l din Lucrări → Devize.</div>}
      {!s.finalDv && <div className="hint-block" style={{ color: "var(--warn)" }}>Nu există încă un deviz „Final” pentru această lucrare — adaugă-l din Lucrări → Devize ca să vezi diferențele.</div>}

      {s.ofertaDv && s.finalDv && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Categorie</th><th className="num">Ofertă</th><th className="num">Final</th><th className="num">Diferență</th></tr></thead>
              <tbody>{perCat.map((c) => (
                <tr key={c.cat}><td>{c.cat}</td><td className="num mono">{ron2(c.o)}</td><td className="num mono">{ron2(c.f)}</td>
                  <td className={`num mono ${c.f - c.o > 0.005 ? "text-danger" : c.f - c.o < -0.005 ? "text-ok" : ""}`}>{ron2(c.f - c.o)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th>Linie</th><th>Stare</th><th className="num">Ofertă (cant. × preț)</th><th className="num">Final (cant. × preț)</th><th className="num">Diferență</th></tr></thead>
              <tbody>
                {diffs.map((r, i) => (
                  <tr key={i}>
                    <td>{r.den}<div className="cell-sub">{r.um}</div></td>
                    <td><Badge tone={tone[r.stare]}>{r.stare}</Badge></td>
                    <td className="num mono">{r.o ? `${r.o.cant} × ${ron2(r.o.total / (r.o.cant || 1))}` : "—"}<div className="cell-sub">{r.o ? ron2(r.o.total) : ""}</div></td>
                    <td className="num mono">{r.f ? `${r.f.cant} × ${ron2(r.f.total / (r.f.cant || 1))}` : "—"}<div className="cell-sub">{r.f ? ron2(r.f.total) : ""}</div></td>
                    <td className={`num mono ${r.delta > 0.005 ? "text-danger" : r.delta < -0.005 ? "text-ok" : ""}`}>{ron2(r.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h4 style={{ margin: "6px 0 0" }}>Facturi emise pe această lucrare</h4>
      {s.facturi.length === 0 ? <EmptyState text="Nicio factură emisă încă." /> : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Data</th><th>Partener</th><th className="num">Fără TVA</th><th>Status</th></tr></thead>
            <tbody>{[...s.facturi].sort((a, b) => (a.data || "").localeCompare(b.data || "")).map((f) => (
              <tr key={f.id}><td className="mono">{fmtDate(f.data)}</td><td>{f.partener}</td><td className="num mono">{ron2(f.valoareFaraTva)}</td><td><Badge tone={f.status === "Încasată" ? "ok" : "neutral"}>{f.status}</Badge></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FinanciarComparatie() {
  const { data } = useData();
  const [detaliuId, setDetaliuId] = useState(null);
  const randuri = data.proiecte.map((p) => ({ p, s: situatieProiect(data, p) }))
    .sort((a, b) => (b.s.final != null) - (a.s.final != null) || a.p.nume.localeCompare(b.p.nume));
  const detaliu = data.proiecte.find((p) => p.id === detaliuId);
  return (
    <div className="stack-lg">
      <p className="section-intro">Comparație automată între devizul ofertă, devizul final și facturile emise, pe fiecare lucrare. Apasă pe o lucrare pentru diferențele pe linii.</p>
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Lucrare</th><th className="num">Ofertă</th><th className="num">Final</th><th className="num">Diferență</th><th className="num">Facturat</th><th className="num">Rămas</th><th>Situație</th></tr></thead>
            <tbody>
              {randuri.map(({ p, s }) => {
                const delta = s.final != null ? s.final - s.oferta : null;
                const pct = delta != null && s.oferta ? (delta / s.oferta) * 100 : null;
                let sit;
                if (s.facturat > s.ref + 0.5) sit = <Badge tone="danger">Supra-facturat</Badge>;
                else if (s.final == null) sit = <Badge tone="neutral">Fără deviz final</Badge>;
                else if (s.rest > 0.5) sit = <Badge tone="warn">De facturat</Badge>;
                else sit = <Badge tone="ok">Facturat integral</Badge>;
                return (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setDetaliuId(p.id)}>
                    <td className="cell-title">{p.nume}</td>
                    <td className="num mono">{ron(s.oferta)}</td>
                    <td className="num mono">{s.final != null ? ron(s.final) : "—"}</td>
                    <td className={`num mono ${delta > 0.5 ? "text-danger" : delta < -0.5 ? "text-ok" : ""}`}>{delta != null ? <>{ron(delta)}<div className="cell-sub">{pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : ""}</div></> : "—"}</td>
                    <td className="num mono">{ron(s.facturat)}</td>
                    <td className={`num mono ${s.rest < -0.5 ? "text-danger" : ""}`}>{ron(s.rest)}</td>
                    <td>{sit}</td>
                  </tr>
                );
              })}
              {randuri.length === 0 && <tr><td colSpan={7}><EmptyState text="Nicio lucrare." /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!detaliu} onClose={() => setDetaliuId(null)} title={`Ofertă vs. final — ${detaliu?.nume || ""}`} wide>
        {detaliu && <DetaliuComparatie proiect={detaliu} data={data} />}
      </Modal>
    </div>
  );
}

// Avertisment în formularul de factură: comparația proiectului, calculată automat.
function SituatieFacturaProiect({ factura }) {
  const { data } = useData();
  if (factura.tip !== "emisa" || !factura.proiectId) return null;
  const p = data.proiecte.find((x) => x.id === factura.proiectId);
  if (!p) return null;
  const s = situatieProiect(data, p, factura.id);
  const aceasta = Number(factura.valoareFaraTva) || 0;
  const dupa = s.facturat + aceasta;
  const depasire = dupa - s.ref;
  return (
    <div className="hint-block field-wide" style={{ lineHeight: 1.6 }}>
      <div>Ofertă: <strong className="mono">{ron2(s.oferta)}</strong>{s.final != null && <> · Final: <strong className="mono">{ron2(s.final)}</strong> ({s.final - s.oferta >= 0 ? "+" : ""}{ron2(s.final - s.oferta)} față de ofertă)</>}</div>
      <div>Facturat până acum: <strong className="mono">{ron2(s.facturat)}</strong> · Rămas de facturat înainte de această factură: <strong className="mono">{ron2(s.rest)}</strong> <span className="cell-sub">(față de {s.refLabel})</span></div>
      {aceasta > 0 && depasire > 0.5 && <div style={{ color: "var(--danger)" }}>Atenție: cu această factură se depășește {s.refLabel} cu {ron2(depasire)}.</div>}
      {aceasta > 0 && depasire <= 0.5 && <div className="text-ok">După această factură rămân de facturat {ron2(Math.max(0, -depasire))}.</div>}
      {s.final == null && <div style={{ color: "var(--warn)" }}>Lucrarea nu are încă deviz final — comparația se face cu {s.refLabel}.</div>}
    </div>
  );
}

const TABURI_FINANCIAR = [
  { key: "facturi", label: "Facturi și TVA" },
  { key: "taxe", label: "Taxe și ANAF" },
  { key: "parteneri", label: "Parteneri și solduri" },
  { key: "cheltuieli", label: "Cheltuieli" },
  { key: "devize", label: "Ofertă vs. final" },
];

function ModuleFinanciar() {
  const [tab, setTab] = useState("facturi");
  const { rol } = useData();
  const taburiVizibile = TABURI_FINANCIAR.filter((t) => rol === "admin" || t.key !== "taxe");
  return (
    <div className="stack-lg">
      <div className="tab-row">
        {taburiVizibile.map((t) => <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab === "facturi" && <FinanciarFacturare />}
      {tab === "taxe" && <FinanciarTaxe />}
      {tab === "parteneri" && <FinanciarParteneri />}
      {tab === "cheltuieli" && <FinanciarCheltuieli />}
      {tab === "devize" && <FinanciarComparatie />}
    </div>
  );
}


function emptyFactura() {
  return { id: null, tip: "emisa", proiectId: "", partener: "", valoareFaraTva: "", cotaTva: 19, data: "", status: "Emisă" };
}

function FinanciarFacturare() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [achizitieModal, setAchizitieModal] = useState(null);
  const [simulareTva, setSimulareTva] = useState(0);
  const [luna, setLuna] = useState(currentMonthKey);

  function saveAchizitie(a) {
    update((d) => {
      if (!d.achizitiiPlanificate) d.achizitiiPlanificate = [];
      const clean = { ...a, valoareEstimata: Number(a.valoareEstimata) || 0, cotaTva: Number(a.cotaTva) || 19 };
      if (a.id) d.achizitiiPlanificate = d.achizitiiPlanificate.map((x) => (x.id === a.id ? clean : x));
      else d.achizitiiPlanificate.push({ ...clean, id: uid() });
      return d;
    });
    toast(a.id ? "Achiziție actualizată." : "Achiziție planificată adăugată.");
    setAchizitieModal(null);
  }

  function removeAchizitie(id) {
    update((d) => { d.achizitiiPlanificate = (d.achizitiiPlanificate || []).filter((a) => a.id !== id); return d; });
    toast("Achiziție ștearsă.", "warn");
  }

  function save(f) {
    update((d) => {
      const clean = { ...f, valoareFaraTva: Number(f.valoareFaraTva) || 0, cotaTva: Number(f.cotaTva) || 0 };
      // Asocierea cu un partener: păstrăm id-ul doar dacă numele nu s-a schimbat; altfel îl regăsim după nume/proiect.
      const prev = f.id ? d.facturi.find((x) => x.id === f.id) : null;
      if (!prev || normTxt(prev.partener) !== normTxt(f.partener)) delete clean.partenerId;
      const toti = [...d.clienti.map((c) => ({ ...c, tip: "client" })), ...(d.furnizori || []).map((x) => ({ ...x, tip: "furnizor" }))];
      const gasit = matchPartener(clean, toti, d.proiecte);
      if (gasit) clean.partenerId = gasit.id;
      else if (clean.tip === "primita" && (clean.partener || "").trim()) {
        const nou = { id: uid(), nume: clean.partener.trim(), cui: "", contact: "", documente: [] };
        d.furnizori = d.furnizori || [];
        d.furnizori.push(nou);
        clean.partenerId = nou.id;
      }
      if (f.id) d.facturi = d.facturi.map((x) => (x.id === f.id ? clean : x));
      else d.facturi.push({ ...clean, id: uid() });
      return d;
    });
    toast(f.id ? "Factură actualizată." : "Factură adăugată.");
    setModal(null);
  }

  function remove(id) {
    update((d) => { d.facturi = d.facturi.filter((f) => f.id !== id); return d; });
    toast("Factură ștearsă.", "warn");
  }

  function toggleInregistrare(id) {
    update((d) => {
      const f = d.facturi.find((x) => x.id === id);
      if (f) f.status = f.status === "Neînregistrată" ? "Înregistrată" : "Neînregistrată";
      return d;
    });
  }

  const luni = [...new Set(data.facturi.map((f) => monthKey(f.data)))].sort().reverse();
  if (!luni.includes(currentMonthKey)) luni.unshift(currentMonthKey);

  const facturiLuna = data.facturi.filter((f) => monthKey(f.data) === luna);
  const tvaColectat = facturiLuna.filter((f) => f.tip === "emisa").reduce((s, f) => s + (f.valoareFaraTva * f.cotaTva) / 100, 0);
  const tvaDeductibil = facturiLuna.filter((f) => f.tip === "primita").reduce((s, f) => s + (f.valoareFaraTva * f.cotaTva) / 100, 0);
  const sold = tvaColectat - tvaDeductibil;
  const neinregistrate = facturiLuna.filter((f) => f.tip === "primita" && f.status === "Neînregistrată");

  const projectName = (id) => data.proiecte.find((p) => p.id === id)?.nume || "—";

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Facturare, urmărire încasări/plăți și gestiunea TVA colectat/deductibil.</p>
        <div className="btn-row">
          <Field label="">
            <select value={luna} onChange={(e) => setLuna(e.target.value)}>
              {luni.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Button onClick={() => setModal(emptyFactura())}><IconPlus size={15} /> Factură nouă</Button>
        </div>
      </div>

      <div className="grid-3">
        <Card><div className="kpi-label">TVA colectat</div><div className="kpi-value mono">{ron(tvaColectat)}</div></Card>
        <Card><div className="kpi-label">TVA deductibil</div><div className="kpi-value mono">{ron(tvaDeductibil)}</div></Card>
        <Card>
          <div className="kpi-label">Sold TVA — {luna}</div>
          <div className={`kpi-value mono ${sold >= 0 ? "text-danger" : "text-ok"}`}>{ron(Math.abs(sold))}</div>
          <div className="kpi-sub">{sold >= 0 ? "de plată către stat" : "de recuperat"}</div>
        </Card>
      </div>

      {neinregistrate.length > 0 && (
        <Card className="warn-card">
          <div className="warn-card-inner">
            <IconAlert size={17} className="text-warn" />
            <span><strong>{neinregistrate.length}</strong> factură/facturi de achiziție neînregistrate încă în {luna} — înregistrarea lor înainte de închiderea perioadei reduce TVA de plată.</span>
          </div>
        </Card>
      )}

      <Card title="Panou de planificare TVA" action={<Button size="sm" variant="ghost" onClick={() => setAchizitieModal({ denumire: "", valoareEstimata: "", cotaTva: 19, dataEstimata: "" })}><IconPlus size={14} /> Achiziție planificată</Button>}>
        <p className="section-intro">
          Achiziții/investiții comandate dar nefacturate încă — dacă le aduceți în față și le înregistrați înainte de închiderea lunii, reduc legal soldul TVA.
          Acest panou NU poate elimina un TVA de plată generat real de marja lunii — doar evită pierderea unor deduceri din neglijență administrativă.
        </p>
        {(data.achizitiiPlanificate || []).length === 0 ? <EmptyState text="Nicio achiziție planificată înregistrată." /> : (
          <ul className="request-list">
            {data.achizitiiPlanificate.map((a) => (
              <li key={a.id}>
                <div>
                  <div className="cell-title">{a.denumire}</div>
                  <div className="cell-sub mono">{ron(a.valoareEstimata)} + TVA {ron((a.valoareEstimata * a.cotaTva) / 100)} · estimat {fmtDate(a.dataEstimata)}</div>
                </div>
                <div className="btn-row">
                  <IconButton title="Editează" onClick={() => setAchizitieModal(a)}><IconEdit size={15} /></IconButton>
                  <ConfirmDelete onConfirm={() => removeAchizitie(a.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {(() => {
          const totalAchizitiiTva = (data.achizitiiPlanificate || []).reduce((s, a) => s + (a.valoareEstimata * a.cotaTva) / 100, 0);
          const soldDacaInregistrate = sold - totalAchizitiiTva;
          return (
            <div className="hint-block">
              TVA total din achiziții planificate: <strong className="mono">{ron(totalAchizitiiTva)}</strong> — dacă toate ar fi înregistrate acum, soldul TVA ar deveni{" "}
              <strong className={`mono ${soldDacaInregistrate >= 0 ? "text-danger" : "text-ok"}`}>{ron(Math.abs(soldDacaInregistrate))}</strong> ({soldDacaInregistrate >= 0 ? "de plată" : "de recuperat"}).
            </div>
          );
        })()}
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Simulare: TVA suplimentar de înregistrat (RON)">
            <input type="number" step="any" value={simulareTva} onChange={(e) => setSimulareTva(Number(e.target.value) || 0)} />
          </Field>
        </div>
        {(() => {
          const soldSimulat = sold - simulareTva;
          return (
            <div className="hint-block">
              Sold simulat: <strong className={`mono ${soldSimulat >= 0 ? "text-danger" : "text-ok"}`}>{ron(Math.abs(soldSimulat))}</strong> ({soldSimulat >= 0 ? "de plată" : "de recuperat"})
            </div>
          );
        })()}
      </Card>

      <Card title="Situație financiară istorică (din balanțele de verificare)">
        <p className="section-intro">
          Cifre reale la nivel de companie, extrase din balanțele de verificare decembrie 2022–2024. Anul 2025 nu a fost încă importat — se poate adăuga printr-o
          re-analiză a balanței de verificare decembrie 2025 când e disponibilă.
        </p>
        <table className="table">
          <thead>
            <tr><th>An</th><th className="num">Cifră afaceri</th><th className="num">Cheltuieli totale</th><th className="num">Profit net</th><th className="num">Capitaluri proprii</th><th className="num">Trezorerie</th></tr>
          </thead>
          <tbody>
            {ISTORIC_FINANCIAR.map((y) => (
              <tr key={y.an}>
                <td className="cell-title">{y.an}</td>
                <td className="num mono">{ron(y.cifraAfaceri)}</td>
                <td className="num mono">{ron(y.totalCheltuieli)}</td>
                <td className={`num mono ${y.profitNet < 0 ? "text-danger" : "text-ok"}`}>{ron(y.profitNet)}</td>
                <td className={`num mono ${y.capitaluriProprii < 0 ? "text-danger" : "text-ok"}`}>{ron(y.capitaluriProprii)}</td>
                <td className={`num mono ${y.trezorerie < 0 ? "text-danger" : "text-ok"}`}>{ron(y.trezorerie)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ultimulAnFinanciar().capitaluriProprii < 0 && (
          <div className="hint-block" style={{ marginTop: 12, color: "var(--danger)" }}>
            Capitaluri proprii negative la finalul lui {ultimulAnFinanciar().an} — situație care necesită atenție (posibilă incidență art. 153^24 din Legea 31/1990 privind societățile).
            Folosește modulul Calculator → Simulator financiar pentru a testa scenarii de redresare.
          </div>
        )}
      </Card>

      <Card title={`Facturi — ${luna}`}>
        <table className="table">
          <thead>
            <tr><th>Tip</th><th>Partener</th><th>Proiect</th><th className="num">Valoare fără TVA</th><th className="num">TVA</th><th>Data</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {facturiLuna.map((f) => (
              <tr key={f.id}>
                <td><Badge tone={f.tip === "emisa" ? "accent" : "neutral"}>{f.tip === "emisa" ? "Emisă" : "Primită"}</Badge></td>
                <td>{f.partener}</td>
                <td>{projectName(f.proiectId)}</td>
                <td className="num mono">{ron(f.valoareFaraTva)}</td>
                <td className="num mono">{ron((f.valoareFaraTva * f.cotaTva) / 100)} <span className="muted">({f.cotaTva}%)</span></td>
                <td className="mono">{fmtDate(f.data)}</td>
                <td>
                  {f.tip === "primita" ? (
                    <button className="badge-btn" onClick={() => toggleInregistrare(f.id)}>
                      <Badge tone={f.status === "Neînregistrată" ? "danger" : "ok"}>{f.status}</Badge>
                    </button>
                  ) : <Badge tone={f.status === "Încasată" ? "ok" : "neutral"}>{f.status}</Badge>}
                </td>
                <td className="actions">
                  <IconButton title="Editează" onClick={() => setModal(f)}><IconEdit size={15} /></IconButton>
                  <ConfirmDelete onConfirm={() => remove(f.id)} />
                </td>
              </tr>
            ))}
            {facturiLuna.length === 0 && <tr><td colSpan={8}><EmptyState text="Nicio factură în această lună." /></td></tr>}
          </tbody>
        </table>
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează factură" : "Factură nouă"} wide>
        {modal && <FacturaForm factura={modal} proiecte={data.proiecte} onSave={save} onCancel={() => setModal(null)} />}
      </Modal>
      <Modal open={!!achizitieModal} onClose={() => setAchizitieModal(null)} title={achizitieModal?.id ? "Editează achiziție planificată" : "Achiziție planificată nouă"}>
        {achizitieModal && <AchizitieForm initial={achizitieModal} onSave={saveAchizitie} onCancel={() => setAchizitieModal(null)} />}
      </Modal>
    </div>
  );
}

function AchizitieForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Denumire achiziție/investiție" wide><input required value={f.denumire} onChange={set("denumire")} /></Field>
      <Field label="Valoare estimată fără TVA (RON)"><input type="number" step="any" required value={f.valoareEstimata} onChange={set("valoareEstimata")} /></Field>
      <Field label="Cotă TVA (%)"><input type="number" step="any" value={f.cotaTva} onChange={set("cotaTva")} /></Field>
      <Field label="Data estimată"><input type="date" value={f.dataEstimata} onChange={set("dataEstimata")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function FacturaForm({ factura, proiecte, onSave, onCancel }) {
  const { data: dateApp } = useData();
  const [f, setF] = useState(factura);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tvaCalc = ((Number(f.valoareFaraTva) || 0) * (Number(f.cotaTva) || 0)) / 100;
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Tip factură">
        <select value={f.tip} onChange={set("tip")}>
          <option value="emisa">Emisă (către client)</option>
          <option value="primita">Primită (de la furnizor)</option>
        </select>
      </Field>
      <Field label="Partener (client/furnizor)">
        <input required list="parteneri-factura" value={f.partener} onChange={set("partener")} />
        <datalist id="parteneri-factura">
          {(f.tip === "emisa" ? dateApp.clienti : (dateApp.furnizori || [])).map((p) => <option key={p.id} value={p.nume} />)}
        </datalist>
      </Field>
      <Field label="Proiect asociat">
        <select value={f.proiectId} onChange={set("proiectId")}>
          <option value="">— fără proiect —</option>
          {proiecte.map((p) => <option key={p.id} value={p.id}>{p.nume}</option>)}
        </select>
      </Field>
      <Field label="Valoare fără TVA (RON)"><input type="number" step="any" required value={f.valoareFaraTva} onChange={set("valoareFaraTva")} /></Field>
      <Field label="Cotă TVA (%)"><input type="number" step="any" value={f.cotaTva} onChange={set("cotaTva")} /></Field>
      <Field label="Data facturii"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Status">
        <select value={f.status} onChange={set("status")}>
          {f.tip === "emisa"
            ? ["Emisă", "Încasată"].map((s) => <option key={s}>{s}</option>)
            : ["Neînregistrată", "Înregistrată"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <div className="hint-block">TVA calculat automat: <strong className="mono">{ron(tvaCalc)}</strong></div>
      {f.tip === "emisa" && /kaufland/i.test(f.partener || "") && (
        <div className="hint-block">Contract-cadru Kaufland nr. 6562/09.04.2025: serviciile dintr-o lună se facturează până pe data de 3 a lunii următoare. Prețurile din contract sunt fără TVA.</div>
      )}
      <SituatieFacturaProiect factura={f} />
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

/* =========================================================================
   MODULE: GESTIUNE PATRIMONIU
   ========================================================================= */

function emptyActiv() {
  return { id: null, tip: "vehicul", denumire: "", marca: "", numarInmatriculare: "", responsabil: "", valoare: "", itpExpira: "", rcaExpira: "", revizieExpira: "", costLunarMediu: 0 };
}
const TIPURI_CHELTUIALA_AUTO = ["Reparație", "Service", "Combustibil", "Leasing", "Altele"];

function ModulePatrimoniu() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [fisaVehiculId, setFisaVehiculId] = useState(null);
  const [cheltuialaForm, setCheltuialaForm] = useState(null); // { vehiculId, cheltuiala } sau null
  const [materialModal, setMaterialModal] = useState(null);

  function save(a) {
    update((d) => {
      const denumireFinala = a.tip === "vehicul" ? `${a.marca} — ${a.numarInmatriculare}` : a.denumire;
      const existent = a.id ? d.active.find((x) => x.id === a.id) : null;
      const clean = {
        ...a, denumire: denumireFinala, valoare: Number(a.valoare) || 0, costLunarMediu: Number(a.costLunarMediu) || 0,
        gpsMontat: existent?.gpsMontat || false, gpsFurnizor: existent?.gpsFurnizor || "", cheltuieliAuto: existent?.cheltuieliAuto || [],
      };
      if (a.id) d.active = d.active.map((x) => (x.id === a.id ? { ...x, ...clean } : x));
      else d.active.push({ ...clean, id: uid() });
      return d;
    });
    toast(a.id ? "Activ actualizat." : "Activ adăugat.");
    setModal(null);
  }

  function remove(id) {
    update((d) => { d.active = d.active.filter((a) => a.id !== id); return d; });
    toast("Activ șters.", "warn");
  }

  function saveGps(vehiculId, gpsMontat, gpsFurnizor) {
    update((d) => {
      const v = d.active.find((x) => x.id === vehiculId);
      if (v) { v.gpsMontat = gpsMontat; v.gpsFurnizor = gpsFurnizor; }
      return d;
    });
    toast("Informații GPS actualizate.");
  }

  function saveCheltuiala(vehiculId, cheltuiala) {
    update((d) => {
      const v = d.active.find((x) => x.id === vehiculId);
      if (!v) return d;
      if (!v.cheltuieliAuto) v.cheltuieliAuto = [];
      const clean = { ...cheltuiala, valoare: Number(cheltuiala.valoare) || 0 };
      if (cheltuiala.id) v.cheltuieliAuto = v.cheltuieliAuto.map((c) => (c.id === cheltuiala.id ? clean : c));
      else v.cheltuieliAuto.push({ ...clean, id: uid() });
      return d;
    });
    toast("Cheltuială înregistrată.");
    setCheltuialaForm(null);
  }

  function removeCheltuiala(vehiculId, cheltuialaId) {
    update((d) => {
      const v = d.active.find((x) => x.id === vehiculId);
      if (v) v.cheltuieliAuto = (v.cheltuieliAuto || []).filter((c) => c.id !== cheltuialaId);
      return d;
    });
    toast("Cheltuială ștearsă.", "warn");
  }

  function saveMaterial(m) {
    update((d) => {
      if (!d.materialeStoc) d.materialeStoc = [];
      const clean = { ...m, cantitate: Number(m.cantitate) || 0, valoareUnitara: Number(m.valoareUnitara) || 0 };
      if (m.id) d.materialeStoc = d.materialeStoc.map((x) => (x.id === m.id ? clean : x));
      else d.materialeStoc.push({ ...clean, id: uid() });
      return d;
    });
    toast(m.id ? "Material actualizat." : "Material adăugat în stoc.");
    setMaterialModal(null);
  }

  function removeMaterial(id) {
    update((d) => { d.materialeStoc = (d.materialeStoc || []).filter((m) => m.id !== id); return d; });
    toast("Material șters.", "warn");
  }

  const tonForTip = { vehicul: "accent", echipament: "neutral", imobil: "ok" };
  const vehiculFisa = data.active.find((a) => a.id === fisaVehiculId);
  const materiale = data.materialeStoc || [];
  const totalMateriale = materiale.reduce((s, m) => s + m.cantitate * m.valoareUnitara, 0);

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Patrimoniu imobiliar, mobiliar și parc auto — inclusiv termene ITP/RCA/revizii.</p>
        <Button onClick={() => setModal(emptyActiv())}><IconPlus size={15} /> Activ nou</Button>
      </div>

      <Card>
        <table className="table">
          <thead>
            <tr><th>Tip</th><th>Denumire</th><th>Responsabil</th><th className="num">Valoare</th><th>ITP</th><th>RCA</th><th>Revizie</th><th></th></tr>
          </thead>
          <tbody>
            {data.active.map((a) => (
              <tr key={a.id}>
                <td><Badge tone={tonForTip[a.tip]}>{a.tip}</Badge></td>
                <td className="cell-title">{a.tip === "vehicul" ? <>{a.marca || "Vehicul"} <span className="cell-sub mono">{a.numarInmatriculare}</span></> : a.denumire}</td>
                <td>{a.responsabil}</td>
                <td className="num mono">{ron(a.valoare)}</td>
                <td>{a.tip === "vehicul" ? <UrgencyBadge date={a.itpExpira} /> : <span className="muted">—</span>}</td>
                <td>{a.tip === "vehicul" ? <UrgencyBadge date={a.rcaExpira} /> : <span className="muted">—</span>}</td>
                <td>{a.tip === "vehicul" ? <UrgencyBadge date={a.revizieExpira} /> : <span className="muted">—</span>}</td>
                <td className="actions">
                  {a.tip === "vehicul" && <Button size="sm" variant="ghost" onClick={() => setFisaVehiculId(a.id)}>Fișă</Button>}
                  <IconButton title="Editează" onClick={() => setModal(a)}><IconEdit size={15} /></IconButton>
                  <ConfirmDelete onConfirm={() => remove(a.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Materiale în stoc (companie)" action={<Button size="sm" onClick={() => setMaterialModal({ denumire: "", cantitate: 1, um: "buc", valoareUnitara: 0 })}><IconPlus size={14} /> Material nou</Button>}>
        <p className="section-intro">Stoc introdus manual — separat de materialele achiziționate/puse în operă per proiect (din Gestiune Lucrări).</p>
        {materiale.length === 0 ? <EmptyState text="Niciun material în stoc încă." /> : (
          <>
            <table className="table">
              <thead><tr><th>Denumire</th><th className="num">Cantitate</th><th>UM</th><th className="num">Valoare unitară</th><th className="num">Valoare totală</th><th></th></tr></thead>
              <tbody>
                {materiale.map((m) => (
                  <tr key={m.id}>
                    <td className="cell-title">{m.denumire}</td>
                    <td className="num mono">{m.cantitate}</td>
                    <td>{m.um}</td>
                    <td className="num mono">{ron(m.valoareUnitara)}</td>
                    <td className="num mono">{ron(m.cantitate * m.valoareUnitara)}</td>
                    <td className="actions">
                      <IconButton title="Editează" onClick={() => setMaterialModal(m)}><IconEdit size={15} /></IconButton>
                      <ConfirmDelete onConfirm={() => removeMaterial(m.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint-block">Valoare totală stoc materiale: <strong className="mono">{ron(totalMateriale)}</strong></div>
          </>
        )}
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează activ" : "Activ nou"} wide>
        {modal && <ActivForm activ={modal} onSave={save} onCancel={() => setModal(null)} />}
      </Modal>

      <Modal open={!!vehiculFisa} onClose={() => setFisaVehiculId(null)} title={`Fișă vehicul — ${vehiculFisa ? vehiculFisa.marca + " — " + vehiculFisa.numarInmatriculare : ""}`} wide>
        {vehiculFisa && (
          <FisaVehicul
            vehicul={vehiculFisa}
            onSaveGps={(montat, furnizor) => saveGps(vehiculFisa.id, montat, furnizor)}
            onCheltuialaNoua={() => setCheltuialaForm({ vehiculId: vehiculFisa.id, cheltuiala: { tip: "Service", data: "", valoare: 0, notite: "" } })}
            onCheltuialaEdit={(c) => setCheltuialaForm({ vehiculId: vehiculFisa.id, cheltuiala: c })}
            onCheltuialaDelete={(id) => removeCheltuiala(vehiculFisa.id, id)}
          />
        )}
      </Modal>

      <Modal open={!!cheltuialaForm} onClose={() => setCheltuialaForm(null)} title={cheltuialaForm?.cheltuiala?.id ? "Editează cheltuială" : "Cheltuială nouă"}>
        {cheltuialaForm && <CheltuialaAutoForm initial={cheltuialaForm.cheltuiala} onSave={(c) => saveCheltuiala(cheltuialaForm.vehiculId, c)} onCancel={() => setCheltuialaForm(null)} />}
      </Modal>

      <Modal open={!!materialModal} onClose={() => setMaterialModal(null)} title={materialModal?.id ? "Editează material" : "Material nou în stoc"}>
        {materialModal && <MaterialStocForm initial={materialModal} onSave={saveMaterial} onCancel={() => setMaterialModal(null)} />}
      </Modal>
    </div>
  );
}

function FisaVehicul({ vehicul, onSaveGps, onCheltuialaNoua, onCheltuialaEdit, onCheltuialaDelete }) {
  const [gpsMontat, setGpsMontat] = useState(vehicul.gpsMontat || false);
  const [gpsFurnizor, setGpsFurnizor] = useState(vehicul.gpsFurnizor || "");
  const cheltuieli = [...(vehicul.cheltuieliAuto || [])].sort((a, b) => (a.data < b.data ? 1 : -1));
  const total = cheltuieli.reduce((s, c) => s + (Number(c.valoare) || 0), 0);
  return (
    <div className="stack-md">
      <Card title="GPS">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSaveGps(gpsMontat, gpsFurnizor); }}>
          <Field label="Dispozitiv GPS montat"><input type="checkbox" checked={gpsMontat} onChange={(e) => setGpsMontat(e.target.checked)} style={{ width: 18, height: 18, marginTop: 6 }} /></Field>
          <Field label="Furnizor / ID dispozitiv"><input value={gpsFurnizor} onChange={(e) => setGpsFurnizor(e.target.value)} placeholder="ex: FOMCO GPS, serie XYZ" /></Field>
          <div className="hint-block field-wide">Interconectare automată (kilometri, trasee, alerte live) necesită acces API la furnizorul GPS real — momentan doar informativ/manual.</div>
          <div className="form-actions"><Button size="sm" type="submit">Salvează GPS</Button></div>
        </form>
      </Card>
      <div className="section-toolbar">
        <p className="section-intro">Costuri înregistrate pe acest vehicul: reparații, service, combustibil, leasing.</p>
        <Button size="sm" onClick={onCheltuialaNoua}><IconPlus size={14} /> Cheltuială nouă</Button>
      </div>
      {cheltuieli.length === 0 ? <EmptyState text="Nicio cheltuială înregistrată încă." /> : (
        <>
          <table className="table">
            <thead><tr><th>Data</th><th>Tip</th><th className="num">Valoare</th><th>Notițe</th><th></th></tr></thead>
            <tbody>
              {cheltuieli.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{fmtDate(c.data)}</td>
                  <td><Badge tone="neutral">{c.tip}</Badge></td>
                  <td className="num mono">{ron(c.valoare)}</td>
                  <td className="cell-sub">{c.notite}</td>
                  <td className="actions">
                    <IconButton title="Editează" onClick={() => onCheltuialaEdit(c)}><IconEdit size={15} /></IconButton>
                    <ConfirmDelete onConfirm={() => onCheltuialaDelete(c.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint-block">Total cheltuieli înregistrate: <strong className="mono">{ron(total)}</strong></div>
        </>
      )}
    </div>
  );
}

function CheltuialaAutoForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Tip">
        <select value={f.tip} onChange={set("tip")}>
          {TIPURI_CHELTUIALA_AUTO.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Data"><input type="date" required value={f.data} onChange={set("data")} /></Field>
      <Field label="Valoare (RON)"><input type="number" step="any" value={f.valoare} onChange={set("valoare")} /></Field>
      <Field label="Notițe" wide><input value={f.notite} onChange={set("notite")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function MaterialStocForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Denumire" wide><input required value={f.denumire} onChange={set("denumire")} /></Field>
      <Field label="Cantitate"><input type="number" step="any" value={f.cantitate} onChange={set("cantitate")} /></Field>
      <Field label="UM"><input value={f.um} onChange={set("um")} /></Field>
      <Field label="Valoare unitară (RON)"><input type="number" step="any" value={f.valoareUnitara} onChange={set("valoareUnitara")} /></Field>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function ActivForm({ activ, onSave, onCancel }) {
  const [f, setF] = useState(activ);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Tip">
        <select value={f.tip} onChange={set("tip")}>
          <option value="vehicul">Vehicul</option>
          <option value="echipament">Echipament</option>
          <option value="imobil">Imobil</option>
        </select>
      </Field>
      {f.tip === "vehicul" ? (
        <>
          <Field label="Marca / model"><input required value={f.marca || ""} onChange={set("marca")} placeholder="ex: Ford Transit" /></Field>
          <Field label="Număr înmatriculare"><input required value={f.numarInmatriculare || ""} onChange={set("numarInmatriculare")} placeholder="ex: B 110 NVT" /></Field>
        </>
      ) : (
        <Field label="Denumire"><input required value={f.denumire} onChange={set("denumire")} /></Field>
      )}
      <Field label="Responsabil"><input value={f.responsabil} onChange={set("responsabil")} /></Field>
      <Field label="Valoare (RON)"><input type="number" step="any" value={f.valoare} onChange={set("valoare")} /></Field>
      {f.tip === "vehicul" && (
        <>
          <Field label="Expirare ITP"><input type="date" value={f.itpExpira} onChange={set("itpExpira")} /></Field>
          <Field label="Expirare RCA"><input type="date" value={f.rcaExpira} onChange={set("rcaExpira")} /></Field>
          <Field label="Expirare revizie"><input type="date" value={f.revizieExpira} onChange={set("revizieExpira")} /></Field>
          <Field label="Cost lunar mediu (RON)"><input type="number" step="any" value={f.costLunarMediu || 0} onChange={set("costLunarMediu")} /></Field>
        </>
      )}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează</Button>
      </div>
    </form>
  );
}

function emptyCashflowSaptamana() {
  const cheltuieli = {};
  CATEGORII_CHELTUIELI_FIXE.forEach(([k]) => { cheltuieli[k] = 0; });
  CATEGORII_CHELTUIELI_VARIABILE.forEach(([k]) => { cheltuieli[k] = 0; });
  return { id: null, saptamana: "", an: new Date().getFullYear(), soldInceput: 0,
    venituri: { echipamente: 0, produseMateriale: 0, servicii: 0, alteSurse: 0 }, cheltuieli };
}

function ModuleCashflow() {
  const { data, update } = useData();
  const toast = useToast();
  const [modal, setModal] = useState(null);

  function save(s) {
    update((d) => {
      if (!d.cashflow) d.cashflow = [];
      const clean = {
        ...s, an: Number(s.an) || new Date().getFullYear(), soldInceput: Number(s.soldInceput) || 0,
        venituri: Object.fromEntries(Object.entries(s.venituri).map(([k, v]) => [k, Number(v) || 0])),
        cheltuieli: Object.fromEntries(Object.entries(s.cheltuieli).map(([k, v]) => [k, Number(v) || 0])),
      };
      if (s.id) d.cashflow = d.cashflow.map((x) => (x.id === s.id ? clean : x));
      else d.cashflow.push({ ...clean, id: uid() });
      return d;
    });
    toast(s.id ? "Săptămână actualizată." : "Săptămână adăugată în cash-flow.");
    setModal(null);
  }

  function remove(id) {
    update((d) => { d.cashflow = d.cashflow.filter((s) => s.id !== id); return d; });
    toast("Săptămână ștearsă.", "warn");
  }

  function genereazaAutomat() {
    const zile = saptamanaCurenta();
    const [zileStart, zileFinal] = [zile[0], zile[6]];
    const numeLuni = ["IAN", "FEB", "MAR", "APR", "MAI", "IUN", "IUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const luniData = new Date(zileStart + "T00:00:00");
    const eticheta = `${luniData.getDate()}-${new Date(zileFinal + "T00:00:00").getDate()} ${numeLuni[luniData.getMonth()]}`;
    const an = luniData.getFullYear();
    const dejaExista = (data.cashflow || []).some((s) => s.saptamana === eticheta && s.an === an);
    if (dejaExista) { toast("Săptămâna curentă a fost deja generată.", "warn"); return; }

    const saptamaniExistente = data.cashflow || [];
    const ultimaS = saptamaniExistente[saptamaniExistente.length - 1];
    const soldInceputAuto = ultimaS ? (Number(ultimaS.soldInceput) || 0) + soldCashSaptamana(ultimaS, data.active) : 0;

    const venituriServicii = data.facturi.filter((f) => f.tip === "emisa" && f.status === "Încasată" && f.data >= zileStart && f.data <= zileFinal)
      .reduce((s, f) => s + f.valoareFaraTva + (f.valoareFaraTva * f.cotaTva) / 100, 0);

    const salariiLunaCurenta = (data.salarii || []).filter((s) => s.luna === currentMonthKey).reduce((s, x) => s + (Number(x.cost) || 0), 0);

    const cheltuieli = {};
    CATEGORII_CHELTUIELI_FIXE.forEach(([k]) => { cheltuieli[k] = 0; });
    CATEGORII_CHELTUIELI_VARIABILE.forEach(([k]) => { cheltuieli[k] = 0; });
    cheltuieli.salarii = Math.round(salariiLunaCurenta / 4.33);

    update((d) => {
      if (!d.cashflow) d.cashflow = [];
      d.cashflow.push({
        id: uid(), saptamana: eticheta, an, soldInceput: Math.round(soldInceputAuto * 100) / 100,
        venituri: { echipamente: 0, produseMateriale: 0, servicii: Math.round(venituriServicii * 100) / 100, alteSurse: 0 },
        cheltuieli,
      });
      return d;
    });
    toast("Săptămâna curentă a fost generată automat din datele disponibile în aplicație.");
  }

  const saptamani = data.cashflow || [];
  const ultima = saptamani[saptamani.length - 1];
  const soldCurent = ultima ? (Number(ultima.soldInceput) || 0) + soldCashSaptamana(ultima, data.active) : 0;
  const costAutoLunar = totalCheltuieliAutoLunar(data.active);

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Proiecție săptămânală de cash-flow, cu sold reportat automat de la o săptămână la alta (GCF-01..GCF-07).</p>
        <div className="btn-row">
          <Button variant="ghost" onClick={genereazaAutomat}><IconPlus size={15} /> Generează săptămâna curentă automat</Button>
          <Button onClick={() => setModal(emptyCashflowSaptamana())}><IconPlus size={15} /> Săptămână nouă</Button>
        </div>
      </div>
      <div className="hint-block">Generarea automată populează venituri din facturile încasate și cheltuieli cu salariile/auto deja înregistrate în aplicație. Nu există (încă) o conexiune reală cu banca sau cu un soft de facturare extern — necesită acces API la acestea.</div>

      <div className="grid-3">
        <Card>
          <div className="kpi-label">Sold curent (ultima săptămână introdusă)</div>
          <div className={`kpi-value mono ${soldCurent < 0 ? "text-danger" : "text-ok"}`}>{ron(soldCurent)}</div>
        </Card>
        <Card>
          <div className="kpi-label">Cheltuieli auto lunare (toate mașinile)</div>
          <div className="kpi-value mono">{ron(costAutoLunar)}</div>
          <div className="kpi-sub">preluat automat din Gestiune Patrimoniu</div>
        </Card>
        <Card><div className="kpi-label">Săptămâni introduse</div><div className="kpi-value">{saptamani.length}</div></Card>
      </div>

      <Card title="Proiecție săptămânală">
        <table className="table">
          <thead>
            <tr><th>Săptămâna</th><th>An</th><th className="num">Sold început</th><th className="num">Venituri</th><th className="num">Cheltuieli</th><th className="num">Sold cash</th><th className="num">Sold final</th><th></th></tr>
          </thead>
          <tbody>
            {saptamani.length === 0 ? <tr><td colSpan={8}><EmptyState text="Nicio săptămână introdusă încă." /></td></tr> : saptamani.map((s) => {
              const venit = totalVenituriSaptamana(s);
              const chFixe = totalCheltuieliFixeSaptamana(s, data.active);
              const chVar = totalCheltuieliVariabileSaptamana(s);
              const soldCash = venit - chFixe - chVar;
              const soldFinal = (Number(s.soldInceput) || 0) + soldCash;
              return (
                <tr key={s.id}>
                  <td className="cell-title">{s.saptamana}</td>
                  <td className="mono">{s.an}</td>
                  <td className="num mono">{ron(s.soldInceput)}</td>
                  <td className="num mono text-ok">{ron(venit)}</td>
                  <td className="num mono text-danger">{ron(chFixe + chVar)}</td>
                  <td className={`num mono ${soldCash < 0 ? "text-danger" : "text-ok"}`}>{ron(soldCash)}</td>
                  <td className={`num mono ${soldFinal < 0 ? "text-danger" : "text-ok"}`}>{ron(soldFinal)}</td>
                  <td className="actions">
                    <IconButton title="Editează" onClick={() => setModal(s)}><IconEdit size={15} /></IconButton>
                    <ConfirmDelete onConfirm={() => remove(s.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează săptămâna" : "Săptămână nouă (cash-flow)"} wide>
        {modal && <CashflowForm initial={modal} onSave={save} onCancel={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

function CashflowForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setVenit = (k) => (e) => setF({ ...f, venituri: { ...f.venituri, [k]: e.target.value } });
  const setChelt = (k) => (e) => setF({ ...f, cheltuieli: { ...f.cheltuieli, [k]: e.target.value } });
  return (
    <form className="stack-md" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <div className="form-grid">
        <Field label="Săptămâna (ex: 16|20-26 APR)"><input required value={f.saptamana} onChange={set("saptamana")} /></Field>
        <Field label="An"><input type="number" step="any" value={f.an} onChange={set("an")} /></Field>
        <Field label="Sold început (RON)" wide><input type="number" step="any" value={f.soldInceput} onChange={set("soldInceput")} /></Field>
      </div>
      <p className="section-intro">Venituri (RON, cu TVA inclus, ca în proiecția voastră).</p>
      <div className="form-grid">
        <Field label="Vânzare echipamente"><input type="number" step="any" value={f.venituri.echipamente} onChange={setVenit("echipamente")} /></Field>
        <Field label="Vânzare produse/materiale"><input type="number" step="any" value={f.venituri.produseMateriale} onChange={setVenit("produseMateriale")} /></Field>
        <Field label="Servicii (manoperă)"><input type="number" step="any" value={f.venituri.servicii} onChange={setVenit("servicii")} /></Field>
        <Field label="Alte surse"><input type="number" step="any" value={f.venituri.alteSurse} onChange={setVenit("alteSurse")} /></Field>
      </div>
      <p className="section-intro">Cheltuieli fixe (RON).</p>
      <div className="form-grid">
        {CATEGORII_CHELTUIELI_FIXE.map(([key, label]) => (
          <Field key={key} label={label}><input type="number" step="any" value={f.cheltuieli[key] || 0} onChange={setChelt(key)} /></Field>
        ))}
      </div>
      <div className="hint-block">Cheltuieli auto (RCA/rovinietă/ITP/combustibil/service, toate mașinile) — preluate automat din Gestiune Patrimoniu, nu se introduc manual aici.</div>
      <p className="section-intro">Cheltuieli variabile (RON).</p>
      <div className="form-grid">
        {CATEGORII_CHELTUIELI_VARIABILE.map(([key, label]) => (
          <Field key={key} label={label}><input type="number" step="any" value={f.cheltuieli[key] || 0} onChange={setChelt(key)} /></Field>
        ))}
      </div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Anulează</Button>
        <Button type="submit">Salvează săptămâna</Button>
      </div>
    </form>
  );
}

/* =========================================================================
   MODULE: CALCULATOR (deviz/ofertă · cost proiect · simulator financiar)
   ========================================================================= */

function ModuleCalculator() {
  const [tab, setTab] = useState("deviz");
  const TABS = [
    { key: "deviz", label: "Deviz / Ofertă" },
    { key: "cost", label: "Cost proiect" },
    { key: "simulator", label: "Simulator financiar" },
  ];
  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Calculator integrat cu restul aplicației: ofertare rapidă, analiză marjă pe proiect și simulare de scenarii financiare pornind de la datele reale Novatech.</p>
        <div className="tab-row">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "deviz" && <CalculatorDeviz />}
      {tab === "cost" && <CalculatorCostProiect />}
      {tab === "simulator" && <CalculatorSimulator />}
    </div>
  );
}

/* ------------------------ 1. Calculator deviz/ofertă ------------------------ */

function CalculatorDeviz() {
  const { data, update } = useData();
  const toast = useToast();
  const [linii, setLinii] = useState([]);
  const [tarifeOpen, setTarifeOpen] = useState(false);
  const [numeProiect, setNumeProiect] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientNou, setClientNou] = useState("");
  const [categorie, setCategorie] = useState(CATEGORII_PROIECT[CATEGORII_PROIECT.length - 1]);

  function addLinie() {
    setLinii([...linii, { id: uid(), categorie: "Materiale consumabile", cod: "", denumire: "", furnizor: "", um: "buc", cantitate: 1, pretUnitar: 0 }]);
  }
  function updateLinie(id, field, value) { setLinii(linii.map((l) => (l.id === id ? { ...l, [field]: value } : l))); }
  function removeLinie(id) { setLinii(linii.filter((l) => l.id !== id)); }

  const totalGeneral = linii.reduce((s, l) => s + totalLinie(l), 0);
  const perCategorie = CATEGORII_DEVIZ.map((cat) => ({ cat, total: linii.filter((l) => l.categorie === cat).reduce((s, l) => s + totalLinie(l), 0) }));

  function salveazaCaProiectNou() {
    if (!numeProiect.trim()) { toast("Introdu denumirea proiectului.", "warn"); return; }
    if (!clientId && !clientNou.trim()) { toast("Alege un client existent sau introdu unul nou.", "warn"); return; }
    if (linii.length === 0) { toast("Adaugă cel puțin o linie de deviz.", "warn"); return; }
    update((d) => {
      let finalClientId = clientId;
      if (!finalClientId) {
        finalClientId = uid();
        d.clienti.push({ id: finalClientId, nume: clientNou.trim(), contact: "" });
      }
      d.proiecte.push({
        id: uid(), nume: numeProiect.trim(), clientId: finalClientId, categorie, stadiu: "Ofertare", procentExecutie: 0,
        valoareOferta: Math.round(totalGeneral * 100) / 100, valoareContract: null, costRealizat: 0, dataStart: "", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0,
        devize: [{ id: uid(), moment: "Inițial (ofertă)", data: new Date().toISOString().slice(0, 10), linii }],
        activitatiGantt: [],
      });
      return d;
    });
    toast("Proiect nou creat din calculator, cu devizul inițial salvat în Gestiune Lucrări.");
    setLinii([]); setNumeProiect(""); setClientId(""); setClientNou("");
  }

  return (
    <div className="stack-lg">
      <Card title="Date proiect">
        <div className="form-grid">
          <Field label="Denumire proiect" wide><input value={numeProiect} onChange={(e) => setNumeProiect(e.target.value)} placeholder="ex: k310 — Kaufland Militari — condiționare chimică" /></Field>
          <Field label="Client existent">
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); if (e.target.value) setClientNou(""); }}>
              <option value="">— alege client existent —</option>
              {data.clienti.map((c) => <option key={c.id} value={c.id}>{c.nume}</option>)}
            </select>
          </Field>
          <Field label="Sau client nou" hint="completează doar dacă nu alegi din listă">
            <input value={clientNou} onChange={(e) => { setClientNou(e.target.value); if (e.target.value) setClientId(""); }} placeholder="Denumire client nou" />
          </Field>
          <Field label="Categorie">
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
              {CATEGORII_PROIECT.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Linii deviz">
        <table className="table">
          <thead>
            <tr><th>Categorie</th><th>Denumire</th><th>Furnizor</th><th>UM</th><th className="num">Cant.</th><th className="num">Preț unitar</th><th className="num">Total</th><th></th></tr>
          </thead>
          <tbody>
            {linii.map((l) => (
              <tr key={l.id}>
                <td>
                  <select value={l.categorie} onChange={(e) => updateLinie(l.id, "categorie", e.target.value)}>
                    {CATEGORII_DEVIZ.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td><input value={l.denumire} onChange={(e) => updateLinie(l.id, "denumire", e.target.value)} placeholder="Denumire" /></td>
                <td style={{ width: 90 }}><input value={l.furnizor || ""} onChange={(e) => updateLinie(l.id, "furnizor", e.target.value)} placeholder="Furnizor" /></td>
                <td style={{ width: 60 }}><input value={l.um} onChange={(e) => updateLinie(l.id, "um", e.target.value)} /></td>
                <td className="num"><input type="number" step="any" style={{ width: 65 }} value={l.cantitate} onChange={(e) => updateLinie(l.id, "cantitate", e.target.value)} /></td>
                <td className="num"><input type="number" step="any" style={{ width: 85 }} value={l.pretUnitar} onChange={(e) => updateLinie(l.id, "pretUnitar", e.target.value)} /></td>
                <td className="num mono">{ron(totalLinie(l))}</td>
                <td><IconButton title="Șterge linia" type="button" onClick={() => removeLinie(l.id)}><IconTrash size={14} /></IconButton></td>
              </tr>
            ))}
            {linii.length === 0 && <tr><td colSpan={8}><EmptyState text="Nicio linie încă — adaugă prima linie de deviz." /></td></tr>}
          </tbody>
        </table>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <Button variant="ghost" size="sm" onClick={addLinie}><IconPlus size={14} /> Adaugă linie</Button>
          {TARIFE_CONTRACTE.length > 0 && <Button variant="ghost" size="sm" onClick={() => setTarifeOpen(!tarifeOpen)}>{tarifeOpen ? "Ascunde tarifele contract" : "Din tarife contract (Kaufland)"}</Button>}
        </div>
        {tarifeOpen && <div style={{ marginTop: 10 }}><TarifeContract onAdd={(l) => setLinii((cur) => [...cur, l])} /></div>}
      </Card>

      <div className="grid-4">
        {perCategorie.map(({ cat, total }) => (
          <Card key={cat}><div className="kpi-label">{cat}</div><div className="kpi-value mono" style={{ fontSize: 19 }}>{ron(total)}</div></Card>
        ))}
        <Card><div className="kpi-label">Total ofertă</div><div className="kpi-value mono" style={{ fontSize: 19 }}>{ron(totalGeneral)}</div></Card>
      </div>

      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={salveazaCaProiectNou} disabled={linii.length === 0}><IconPlus size={15} /> Salvează ca proiect nou (în Gestiune Lucrări)</Button>
      </div>
    </div>
  );
}

/* ------------------------ 2. Calculator cost proiect ------------------------ */

function CalculatorCostProiect() {
  const { data } = useData();
  const [proiectId, setProiectId] = useState("");
  const [valoareManual, setValoareManual] = useState("");
  const [oreManopera, setOreManopera] = useState(0);
  const [angajatId, setAngajatId] = useState("");
  const [costOraManual, setCostOraManual] = useState(80);
  const [materiale, setMateriale] = useState(0);
  const [echipamente, setEchipamente] = useState(0);
  const [marjaTinta, setMarjaTinta] = useState(20);

  const proiect = data.proiecte.find((p) => p.id === proiectId);
  const valoareOferta = proiect ? (proiect.valoareContract ?? proiect.valoareOferta ?? 0) : (Number(valoareManual) || 0);
  const angajat = data.angajati.find((a) => a.id === angajatId);
  const costOraEfectiv = angajat ? (Number(angajat.costOra) || 0) : (Number(costOraManual) || 0);
  const costManopera = (Number(oreManopera) || 0) * costOraEfectiv;
  const costTotal = costManopera + (Number(materiale) || 0) + (Number(echipamente) || 0);
  const marja = valoareOferta - costTotal;
  const marjaPct = valoareOferta ? (marja / valoareOferta) * 100 : 0;
  const pretMinimRecomandat = marjaTinta < 100 ? costTotal / (1 - marjaTinta / 100) : null;
  const atingeTinta = marjaPct >= Number(marjaTinta);

  return (
    <div className="stack-lg">
      <Card title="Proiect de referință">
        <div className="form-grid">
          <Field label="Proiect existent" wide>
            <select value={proiectId} onChange={(e) => setProiectId(e.target.value)}>
              <option value="">— fără proiect, introdu valoarea manual —</option>
              {data.proiecte.map((p) => <option key={p.id} value={p.id}>{p.nume}</option>)}
            </select>
          </Field>
          {!proiectId && <Field label="Valoare ofertă/contract (RON)"><input type="number" step="any" value={valoareManual} onChange={(e) => setValoareManual(e.target.value)} /></Field>}
          {proiectId && <div className="hint-block field-wide">Valoare ofertă/contract preluată din proiect: <strong className="mono">{ron(valoareOferta)}</strong></div>}
        </div>
      </Card>

      <Card title="Estimare cost">
        <div className="form-grid">
          <Field label="Ore manoperă estimate"><input type="number" step="any" value={oreManopera} onChange={(e) => setOreManopera(e.target.value)} /></Field>
          <Field label="Angajat (pentru cost/oră)">
            <select value={angajatId} onChange={(e) => setAngajatId(e.target.value)}>
              <option value="">— cost/oră manual —</option>
              {data.angajati.filter((a) => a.activ !== false).map((a) => <option key={a.id} value={a.id}>{a.nume} ({ron(a.costOra)}/oră)</option>)}
            </select>
          </Field>
          {!angajatId && <Field label="Cost/oră manual (RON)"><input type="number" step="any" value={costOraManual} onChange={(e) => setCostOraManual(e.target.value)} /></Field>}
          <Field label="Cost materiale (RON)"><input type="number" step="any" value={materiale} onChange={(e) => setMateriale(e.target.value)} /></Field>
          <Field label="Cost echipamente/instalații (RON)"><input type="number" step="any" value={echipamente} onChange={(e) => setEchipamente(e.target.value)} /></Field>
          <Field label="Marjă țintă (%)" hint="pragul minim de profitabilitate dorit"><input type="number" step="any" value={marjaTinta} onChange={(e) => setMarjaTinta(e.target.value)} /></Field>
        </div>
      </Card>

      <div className="grid-4">
        <Card><div className="kpi-label">Cost manoperă</div><div className="kpi-value mono" style={{ fontSize: 19 }}>{ron(costManopera)}</div></Card>
        <Card><div className="kpi-label">Cost total estimat</div><div className="kpi-value mono" style={{ fontSize: 19 }}>{ron(costTotal)}</div></Card>
        <Card>
          <div className="kpi-label">Marjă estimată</div>
          <div className={`kpi-value mono ${marja < 0 ? "text-danger" : "text-ok"}`} style={{ fontSize: 19 }}>{ron(marja)}</div>
          <div className={`kpi-sub mono ${marja < 0 ? "text-danger" : "text-ok"}`}>{marjaPct.toFixed(1)}%</div>
        </Card>
        <Card>
          <div className="kpi-label">Preț minim recomandat</div>
          <div className="kpi-value mono" style={{ fontSize: 19 }}>{pretMinimRecomandat !== null ? ron(pretMinimRecomandat) : "—"}</div>
          <div className="kpi-sub">pentru marja țintă de {marjaTinta}%</div>
        </Card>
      </div>

      <Card className={atingeTinta ? "" : "warn-card"}>
        <div className="warn-card-inner" style={atingeTinta ? { color: "var(--ok)" } : {}}>
          {atingeTinta ? <IconCheck size={17} /> : <IconAlert size={17} className="text-warn" />}
          <span>
            {atingeTinta
              ? `Marja estimată (${marjaPct.toFixed(1)}%) atinge ținta de ${marjaTinta}%.`
              : `Marja estimată (${marjaPct.toFixed(1)}%) este sub ținta de ${marjaTinta}% — ia în calcul prețul minim recomandat de mai sus.`}
          </span>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------ 3. Simulator financiar ------------------------ */

function CalculatorSimulator() {
  const { data } = useData();
  const baseline = ultimulAnFinanciar();
  const [venituriLunareSuplimentare, setVenituriLunareSuplimentare] = useState(0);
  const [cheltuieliLunareSuplimentare, setCheltuieliLunareSuplimentare] = useState(0);
  const [luniProiectie, setLuniProiectie] = useState(12);

  const saptamani = data.cashflow || [];
  const ultima = saptamani[saptamani.length - 1];
  const soldCashActual = ultima ? (Number(ultima.soldInceput) || 0) + soldCashSaptamana(ultima, data.active) : (baseline?.trezorerie || 0);

  const luni = Number(luniProiectie) || 0;
  const impactNetLunar = (Number(venituriLunareSuplimentare) || 0) - (Number(cheltuieliLunareSuplimentare) || 0);
  const soldProiectat = soldCashActual + impactNetLunar * luni;

  const profitAnualBaza = baseline?.profitNet || 0;
  const profitAnualSimulat = profitAnualBaza + impactNetLunar * 12;

  return (
    <div className="stack-lg">
      <div className="hint-block">
        Punct de plecare: sold cash curent din Cash-Flow ({ron(soldCashActual)}) și profitul net al ultimului an financiar disponibil,
        {" "}{baseline?.an} ({ron(baseline?.profitNet || 0)}) — vezi „Situație financiară istorică” în modulul Financiar.
      </div>
      <Card title="Scenariu">
        <div className="form-grid">
          <Field label="Venituri lunare suplimentare (RON)" hint="ex: contracte noi, servicii extra"><input type="number" step="any" value={venituriLunareSuplimentare} onChange={(e) => setVenituriLunareSuplimentare(e.target.value)} /></Field>
          <Field label="Cheltuieli lunare suplimentare (RON)" hint="ex: angajare, chirie nouă, credit"><input type="number" step="any" value={cheltuieliLunareSuplimentare} onChange={(e) => setCheltuieliLunareSuplimentare(e.target.value)} /></Field>
          <Field label="Orizont de proiecție (luni)"><input type="number" step="1" min="1" value={luniProiectie} onChange={(e) => setLuniProiectie(e.target.value)} /></Field>
        </div>
      </Card>

      <div className="grid-3">
        <Card>
          <div className="kpi-label">Impact net lunar</div>
          <div className={`kpi-value mono ${impactNetLunar < 0 ? "text-danger" : "text-ok"}`}>{ron(impactNetLunar)}</div>
        </Card>
        <Card>
          <div className="kpi-label">Sold cash proiectat — {luni} luni</div>
          <div className={`kpi-value mono ${soldProiectat < 0 ? "text-danger" : "text-ok"}`}>{ron(soldProiectat)}</div>
          <div className="kpi-sub">pornind de la soldul curent de cash-flow</div>
        </Card>
        <Card>
          <div className="kpi-label">Profit anual estimat</div>
          <div className={`kpi-value mono ${profitAnualSimulat < 0 ? "text-danger" : "text-ok"}`}>{ron(profitAnualSimulat)}</div>
          <div className="kpi-sub">bază {baseline?.an}: {ron(profitAnualBaza)} + scenariu × 12 luni</div>
        </Card>
      </div>

      {baseline && baseline.capitaluriProprii < 0 && (
        <Card className="warn-card">
          <div className="warn-card-inner">
            <IconAlert size={17} className="text-warn" />
            <span>Capitalurile proprii la 31.12.{baseline.an} sunt negative ({ron(baseline.capitaluriProprii)}) — scenariile de redresare ar trebui verificate și cu un consultant contabil, ținând cont de obligațiile legale asociate (art. 153^24 Legea 31/1990).</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/* =========================================================================
   SHELL / NAVIGARE
   ========================================================================= */

const NAV = [
  { key: "dashboard", label: "Tablou de bord", Icon: IconDash, View: Dashboard },
  { key: "lucrari", label: "Lucrări", Icon: IconWorks, View: ModuleLucrari },
  { key: "calendar", label: "Calendar", Icon: IconCalendar, View: ModuleCalendar },
  { key: "personal", label: "Personal", Icon: IconUsers, View: ModulePersonal },
  { key: "clienti", label: "Clienți", Icon: IconClients, View: ModuleClienti },
  { key: "financiar", label: "Financiar", Icon: IconMoney, View: ModuleFinanciar },
  { key: "patrimoniu", label: "Patrimoniu", Icon: IconTruck, View: ModulePatrimoniu },
  { key: "cashflow", label: "Cash-Flow", Icon: IconCashflow, View: ModuleCashflow },
  { key: "calculator", label: "Calculator", Icon: IconCalc, View: ModuleCalculator },
  { key: "securitate", label: "Securitate", Icon: IconLock, View: ModuleSecuritate },
];

const CONTEXT_APLICATIE = `Ești asistentul integrat al aplicației Novatech ERP (Novatech Proiect SRL — HVAC, automatizări/instalații electrice, instalații sanitare, facility management).
Aplicația are 8 module: Tablou de bord, Gestiune Lucrări (proiecte, devize pe categorii instalații/materiale/manoperă, 3 momente: inițial/suplimentar/final, procent execuție), Gestiune Personal (angajați, cost/oră, concedii odihnă/medical cu calcul automat de zile lucrătoare excl. weekend și sărbători legale, certificări, medicina muncii, pontaj pe proiect, salarii lunare), Gestiune Clienți (garanții, tichete service), Gestiune Financiară (facturi, TVA colectat/deductibil, panou de planificare TVA cu achiziții planificate, situație financiară istorică din balanțele de verificare 2022-2024), Gestiune Patrimoniu (active, parc auto cu ITP/RCA/revizii), Cash-Flow (proiecție săptămânală), Calculator (deviz/ofertă rapid → devine proiect nou, cost proiect vs. marjă țintă, simulator de scenarii financiare pornind de la datele reale).
Răspunde scurt, practic, în română, ca un coleg care cunoaște aplicația. Dacă întrebarea NU are legătură cu o funcționalitate din aplicație, ghidează utilizatorul cât poți de bine oricum, dar menționează că nu ține de acest modul specific.`;

function AsistentAI({ open, onClose }) {
  const [mesaje, setMesaje] = useState([
    { rol: "assistant", text: "Bună! Sunt asistentul aplicației Novatech ERP. Întreabă-mă orice despre cum funcționează un modul, sau orice altceva la care pot ajuta." },
  ]);
  const [input, setInput] = useState("");
  const [seIncarca, setSeIncarca] = useState(false);
  const [eroare, setEroare] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [mesaje, seIncarca]);

  async function trimite() {
    const text = input.trim();
    if (!text || seIncarca) return;
    const noiMesaje = [...mesaje, { rol: "user", text }];
    setMesaje(noiMesaje);
    setInput("");
    setSeIncarca(true);
    setEroare(null);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: CONTEXT_APLICATIE,
          messages: noiMesaje.map((m) => ({ role: m.rol, content: m.text })),
        }),
      });
      const data = await response.json();
      const textRaspuns = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n") || "Nu am putut genera un răspuns.";
      setMesaje((cur) => [...cur, { rol: "assistant", text: textRaspuns }]);
    } catch (e) {
      setEroare("Asistentul nu a putut răspunde. Funcționează doar cât timp aplicația rulează aici, în Claude.ai.");
    } finally {
      setSeIncarca(false);
    }
  }

  if (!open) return null;
  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span><IconAI size={16} /> Asistent AI — Novatech ERP</span>
        <IconButton title="Închide" onClick={onClose}><IconX size={16} /></IconButton>
      </div>
      <div className="ai-panel-body" ref={scrollRef}>
        {mesaje.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.rol}`}>{m.text}</div>
        ))}
        {seIncarca && <div className="ai-msg ai-msg-assistant ai-typing">Se gândește…</div>}
        {eroare && <div className="ai-msg ai-msg-error">{eroare}</div>}
      </div>
      <div className="ai-panel-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") trimite(); }}
          placeholder="Întreabă orice despre aplicație…"
        />
        <Button size="sm" onClick={trimite} disabled={seIncarca}>Trimite</Button>
      </div>
    </div>
  );
}

/* =========================================================================
   MODUL: SECURITATE — cont, verificare în doi pași, copii de siguranță
   ========================================================================= */

function SecContul() {
  const sec = useSec();
  const toast = useToast();
  const [enroll, setEnroll] = useState(null);
  const [cod, setCod] = useState("");
  const [eroare, setEroare] = useState("");
  const [parola, setParola] = useState("");
  const [parola2, setParola2] = useState("");
  const [msgParola, setMsgParola] = useState("");
  const [confirmDez, setConfirmDez] = useState(false);

  async function porneste2fa() {
    setEroare("");
    const { data: fl } = await supabase.auth.mfa.listFactors();
    for (const f of (fl?.all || []).filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Novatech " + new Date().toISOString().slice(0, 16) });
    if (error) { setEroare(error.message); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCod("");
  }
  async function confirma2fa() {
    setEroare("");
    const err = await verificaCodTotp(enroll.id, cod);
    if (err) { setEroare(err); return; }
    setEnroll(null);
    toast("Verificarea în doi pași este activă.");
    sec.reevalueaza();
  }
  async function dezactiveaza2fa() {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: sec.factorId });
    setConfirmDez(false);
    if (error) { setEroare(error.message); return; }
    toast("Verificarea în doi pași a fost dezactivată.", "warn");
    sec.reevalueaza();
  }
  async function schimbaParola(e) {
    e.preventDefault();
    setMsgParola("");
    if (parola.length < 12) { setMsgParola("Parola trebuie să aibă cel puțin 12 caractere."); return; }
    if (!/[A-Za-z]/.test(parola) || !/\d/.test(parola)) { setMsgParola("Parola trebuie să conțină litere și cifre."); return; }
    if (parola !== parola2) { setMsgParola("Cele două parole nu coincid."); return; }
    const { error } = await supabase.auth.updateUser({ password: parola });
    if (error) { setMsgParola(error.message); return; }
    setParola(""); setParola2("");
    toast("Parola a fost schimbată.");
  }

  return (
    <div className="stack-lg">
      <Card title="Contul meu">
        <div className="stack-md">
          <div><span className="muted">Email: </span><b>{sec.session?.user?.email || "—"}</b></div>
          <div><span className="muted">Rol: </span><Badge tone="accent">{ROLURI[sec.rol] || sec.rol}</Badge></div>
          <div className="hint-block">Aplicația se blochează singură după {MINUTE_BLOCARE} minute fără activitate și cere {sec.mfaActiv ? "codul din telefon" : "parola"} ca să continui.</div>
          <div className="btn-row"><Button variant="ghost" onClick={sec.blocheaza}>Blochează acum</Button></div>
        </div>
      </Card>

      <Card title="Verificare în doi pași (2FA)" action={<Badge tone={sec.mfaActiv ? "ok" : "warn"}>{sec.mfaActiv ? "Activă" : "Neactivă"}</Badge>}>
        <div className="stack-md">
          <div className="hint-block">Chiar dacă cineva află parola, nu poate intra fără codul de 6 cifre din telefonul tău. E cea mai bună protecție împotriva spargerii contului.</div>
          {!sec.mfaActiv && !enroll && <div className="btn-row"><Button onClick={porneste2fa}>Activează 2FA</Button></div>}
          {enroll && (
            <div className="stack-md">
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
                <li>Instalează în telefon <b>Google Authenticator</b> sau <b>Microsoft Authenticator</b>.</li>
                <li>În aplicație alege „Adaugă cont” → „Scanează cod QR” și scanează imaginea de mai jos.</li>
                <li>Scrie aici codul de 6 cifre afișat pentru Novatech și apasă „Confirmă”.</li>
              </ol>
              <img src={enroll.qr} alt="Cod QR pentru 2FA" style={{ width: 190, height: 190, background: "#fff", padding: 8, border: "1px solid var(--line, #ccd)" }} />
              <div className="muted" style={{ fontSize: 12 }}>Dacă nu poți scana: introdu manual cheia <span className="mono">{enroll.secret}</span></div>
              <Field label="Cod de 6 cifre"><CodInput value={cod} onChange={setCod} /></Field>
              <div className="btn-row">
                <Button onClick={confirma2fa} disabled={cod.length !== 6}>Confirmă</Button>
                <Button variant="ghost" onClick={() => setEnroll(null)}>Anulează</Button>
              </div>
            </div>
          )}
          {sec.mfaActiv && !confirmDez && <div className="btn-row"><Button variant="ghost" onClick={() => setConfirmDez(true)}>Dezactivează 2FA</Button></div>}
          {sec.mfaActiv && confirmDez && (
            <div className="btn-row">
              <span>Sigur? Contul va fi protejat doar de parolă.</span>
              <Button variant="danger" onClick={dezactiveaza2fa}>Da, dezactivează</Button>
              <Button variant="ghost" onClick={() => setConfirmDez(false)}>Anulează</Button>
            </div>
          )}
          {eroare && <div className="login-error"><IconAlert size={15} /> {eroare}</div>}
        </div>
      </Card>

      <Card title="Schimbă parola">
        <form className="stack-md" onSubmit={schimbaParola} autoComplete="off">
          <div className="hint-block">Minim 12 caractere, cu litere și cifre. Folosește o parolă pe care nu o ai nicăieri altundeva.</div>
          <div className="grid-2">
            <Field label="Parolă nouă"><input type="password" autoComplete="new-password" value={parola} onChange={(e) => setParola(e.target.value)} /></Field>
            <Field label="Repetă parola nouă"><input type="password" autoComplete="new-password" value={parola2} onChange={(e) => setParola2(e.target.value)} /></Field>
          </div>
          {msgParola && <div className="login-error"><IconAlert size={15} /> {msgParola}</div>}
          <div className="btn-row"><Button type="submit" disabled={!parola}>Schimbă parola</Button></div>
        </form>
      </Card>
    </div>
  );
}

function SecCopii() {
  const { data, inlocuieste } = useData();
  const toast = useToast();
  const [snapshoturi, setSnapshoturi] = useState(null);
  const [fisier, setFisier] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [eroare, setEroare] = useState("");
  const [ultima, setUltima] = useState(() => { try { return localStorage.getItem("novatech-ultima-copie") || ""; } catch (e) { return ""; } });

  function descarca(obiect, nume) {
    const blob = new Blob([JSON.stringify(obiect, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nume; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exporta() {
    const ziua = new Date().toISOString().slice(0, 10);
    descarca(data, `novatech-copie-${ziua}.json`);
    try { localStorage.setItem("novatech-ultima-copie", ziua); } catch (e) {}
    setUltima(ziua);
    toast("Copia de siguranță a fost descărcată. Păstreaz-o într-un loc sigur (nu pe telefon, nu pe email).");
  }
  async function incarcaSnapshoturi() {
    setEroare("");
    const { data: rows, error } = await supabase.from("app_state_backup").select("id,row_id,saved_at,saved_by").order("saved_at", { ascending: false }).limit(40);
    if (error) { setEroare(error.message); return; }
    setSnapshoturi(rows);
  }
  async function descarcaSnapshot(id) {
    const { data: r, error } = await supabase.from("app_state_backup").select("data,row_id,saved_at").eq("id", id).single();
    if (error) { setEroare(error.message); return; }
    descarca(r.data, `novatech-snapshot-${r.saved_at.slice(0, 16).replace(/[:T]/g, "-")}-nivel${r.row_id}.json`);
  }
  async function citesteFisier(e) {
    setEroare(""); setFisier(null); setConfirmText("");
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not-object");
      const chei = Object.keys(obj).filter((k) => k in DATE_VIDE());
      if (!chei.length) { setEroare("Fișierul nu pare o copie Novatech (nu conține secțiuni cunoscute)."); return; }
      setFisier({ nume: f.name, obj, chei });
    } catch (err) {
      setEroare("Fișierul nu a putut fi citit. Alege un fișier .json descărcat din această aplicație.");
    }
  }
  function aplica() {
    const { aplicate, ignorate } = inlocuieste(fisier.obj);
    toast(`Restaurat: ${aplicate.length} secțiuni.${ignorate.length ? ` Ignorate: ${ignorate.length}.` : ""}`, ignorate.length ? "warn" : "ok");
    setFisier(null); setConfirmText("");
  }

  const zileDeLaCopie = ultima ? Math.round((Date.now() - new Date(ultima + "T00:00:00").getTime()) / 86400000) : null;
  return (
    <div className="stack-lg">
      <Card title="Copie de siguranță (descărcare)" action={<Badge tone={zileDeLaCopie === null || zileDeLaCopie > 30 ? "warn" : "ok"}>{ultima ? `ultima: ${fmtDate(ultima)}` : "nu s-a descărcat încă"}</Badge>}>
        <div className="stack-md">
          <div className="hint-block">Descarcă o copie a tuturor datelor într-un fișier. Pe lângă asta, baza de date păstrează automat instantanee (la cel mult 12 ore, ultimele 30 de zile) — vezi mai jos. Recomandare: o copie descărcată o dată pe lună, ținută pe un stick sau într-un spațiu securizat.</div>
          <div className="btn-row"><Button onClick={exporta}>Descarcă copia acum</Button></div>
        </div>
      </Card>

      <Card title="Instantanee automate din baza de date">
        <div className="stack-md">
          {!snapshoturi && <div className="btn-row"><Button variant="ghost" onClick={incarcaSnapshoturi}>Arată instantaneele</Button></div>}
          {snapshoturi && snapshoturi.length === 0 && <EmptyState text="Niciun instantaneu încă. Apar automat după primele modificări." />}
          {snapshoturi && snapshoturi.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Data</th><th>Nivel</th><th>Salvat de</th><th></th></tr></thead>
                <tbody>
                  {snapshoturi.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.saved_at).toLocaleString("ro-RO")}</td>
                      <td>{s.row_id === 1 ? "Operațional" : s.row_id === 2 ? "Birou" : "Confidențial"}</td>
                      <td>{s.saved_by || "—"}</td>
                      <td><button className="link-btn" onClick={() => descarcaSnapshot(s.id)}>Descarcă</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card title="Restaurare / import">
        <div className="stack-md">
          <div className="hint-block">Alege un fișier descărcat de aici (copie completă sau instantaneu). Se înlocuiesc doar secțiunile din fișier; restul rămân neschimbate. Înainte de restaurare, descarcă o copie a stării curente.</div>
          <input type="file" accept="application/json,.json" onChange={citesteFisier} />
          {fisier && (
            <div className="stack-md">
              <div><b>{fisier.nume}</b> — secțiuni care vor fi înlocuite: <span className="mono">{fisier.chei.join(", ")}</span></div>
              <Field label="Pentru confirmare scrie RESTAUREAZA"><input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
              <div className="btn-row">
                <Button variant="danger" disabled={confirmText.trim().toUpperCase() !== "RESTAUREAZA"} onClick={aplica}>Restaurează</Button>
                <Button variant="ghost" onClick={() => setFisier(null)}>Anulează</Button>
              </div>
            </div>
          )}
          {eroare && <div className="login-error"><IconAlert size={15} /> {eroare}</div>}
        </div>
      </Card>
    </div>
  );
}

function ModuleSecuritate() {
  const { rol } = useData();
  const [tab, setTab] = useState("cont");
  const taburi = [{ key: "cont", label: "Cont și 2FA" }, ...(rol === "admin" && supabaseConfigured ? [{ key: "copii", label: "Copii de siguranță" }] : [])];
  if (!supabaseConfigured) {
    return <Card title="Securitate"><div className="hint-block">Funcțiile de securitate (roluri, 2FA, copii automate) sunt active doar când aplicația e conectată la baza de date.</div></Card>;
  }
  return (
    <div className="stack-lg">
      {taburi.length > 1 && (
        <div className="tab-row">
          {taburi.map((t) => <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
      )}
      {tab === "cont" && <SecContul />}
      {tab === "copii" && rol === "admin" && <SecCopii />}
    </div>
  );
}

/* =========================================================================
   MODUL: CALENDAR — harta Gantt a lucrărilor, pontaj pe zile, timp de lucru rămas
   ========================================================================= */

const LUNI_RO = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const ZILE_SC = ["D", "L", "M", "M", "J", "V", "S"];
const CULORI_CATEGORIE = { "Kaufland": "#B5483D", "Nibe": "#2E7D87", "E.ON": "#A9780F", "Lucrări diverse": "#5B6B7B" };
const culoareCategorie = (c) => CULORI_CATEGORIE[normCategorie(c)] || "#5B6B7B";

const dStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseD = (s) => new Date(s + "T00:00:00");
const diffZile = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
const addZile = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dStr(d); };
const addLuni = (s, n) => { const d = parseD(s.slice(0, 7) + "-01"); d.setMonth(d.getMonth() + n); return dStr(d); };
const fmtOre = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("ro-RO");

// Ore estimate pe lucrare: câmpul manual (dacă e completat) sau suma orelor de manoperă din devize
// (devizul Final dacă există; altfel devizul inițial + cele suplimentare).
const RE_ORE = /(^|[^a-zăâîșț])(ore|ora|oră|h)([^a-zăâîșț]|$)/i;
function oreEstimateProiect(p) {
  const manual = Number(p.oreEstimate) || 0;
  if (manual > 0) return { ore: manual, sursa: "manual" };
  const dv = p.devize || [];
  const ultim = (m) => dv.filter((d) => d.moment === m).sort((a, b) => (a.data || "").localeCompare(b.data || "")).slice(-1)[0];
  const final = ultim("Final");
  const set = final ? [final] : [ultim("Inițial (ofertă)"), ...dv.filter((d) => d.moment === "Suplimentar")].filter(Boolean);
  let ore = 0;
  set.forEach((d) => (d.linii || []).forEach((l) => { if (l.categorie === "Manoperă" && RE_ORE.test(l.um || "")) ore += Number(l.cantitate) || 0; }));
  return { ore, sursa: "devize" };
}
function orePeProiect(data) {
  const m = {};
  (data.pontaje || []).forEach((x) => { m[x.proiectId] = (m[x.proiectId] || 0) + (Number(x.ore) || 0); });
  return m;
}

function CalNav({ children }) { return <div className="section-toolbar cal-toolbar">{children}</div>; }

/* ---------- 1. Gantt: distribuția în timp a lucrărilor ---------- */
function CalGantt({ data }) {
  const azi = dStr(new Date());
  const [start, setStart] = useState(addLuni(azi, -1));
  const [luni, setLuni] = useState(6);
  const [cat, setCat] = useState("");
  const [finalizate, setFinalizate] = useState(false);
  const [deschise, setDeschise] = useState({});
  const end = addLuni(start, luni);
  const span = Math.max(1, diffZile(start, end));
  const pos = (s) => Math.max(0, Math.min(100, (diffZile(start, s) / span) * 100));
  const ore = useMemo(() => orePeProiect(data), [data.pontaje]);
  const angajatName = (id) => (data.angajati || []).find((a) => a.id === id)?.nume || "";
  const clientName = (id) => data.clienti.find((c) => c.id === id)?.nume || "";

  const lista = data.proiecte.filter((p) => (!cat || normCategorie(p.categorie) === cat) && (finalizate || p.stadiu !== "Finalizat"));
  const faraDate = lista.filter((p) => !p.dataStart || !p.dataFinal);
  const programate = lista.filter((p) => p.dataStart && p.dataFinal);
  const vizibile = programate.filter((p) => p.dataFinal >= start && p.dataStart < end).sort((a, b) => a.dataStart.localeCompare(b.dataStart));
  const inAfara = programate.length - vizibile.length;
  const luniHeader = Array.from({ length: luni }, (_, i) => {
    const m = addLuni(start, i);
    return { m, left: pos(m), width: (diffZile(m, addLuni(start, i + 1)) / span) * 100 };
  });
  const grupe = CATEGORII_PROIECT.map((c) => ({ cat: c, lista: vizibile.filter((p) => normCategorie(p.categorie) === c) })).filter((g) => g.lista.length);

  function bara(dataStart, dataFinal) {
    const l = pos(dataStart);
    const r = pos(addZile(dataFinal, 1));
    return { left: l + "%", width: Math.max(0.8, r - l) + "%", taiatStanga: dataStart < start, taiatDreapta: dataFinal >= end };
  }

  return (
    <div className="stack-md">
      <CalNav>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => setStart(addLuni(start, -1))}>‹ Luna anterioară</Button>
          <Button size="sm" variant="ghost" onClick={() => setStart(addLuni(azi, -1))}>Azi</Button>
          <Button size="sm" variant="ghost" onClick={() => setStart(addLuni(start, 1))}>Luna următoare ›</Button>
          <select value={luni} onChange={(e) => setLuni(Number(e.target.value))} aria-label="Perioadă afișată">
            <option value={3}>3 luni</option><option value={6}>6 luni</option><option value={12}>12 luni</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categorie">
            <option value="">Toate categoriile</option>
            {CATEGORII_PROIECT.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="cal-check"><input type="checkbox" checked={finalizate} onChange={(e) => setFinalizate(e.target.checked)} /> Arată și lucrările finalizate</label>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{LUNI_RO[parseD(start).getMonth()]} {parseD(start).getFullYear()} – {LUNI_RO[parseD(addLuni(end, -1)).getMonth()]} {parseD(addLuni(end, -1)).getFullYear()}</div>
      </CalNav>

      {vizibile.length === 0 ? (
        <EmptyState text="Nicio lucrare programată în perioada afișată. Schimbă perioada sau completează datele de start și finalizare în modulul Lucrări." />
      ) : (
        <Card>
          <div className="cal-scroll">
            <div className="cal-grid">
              <div className="cal-row cal-head">
                <div className="cal-label" />
                <div className="cal-track cal-months">
                  {luniHeader.map((m) => (
                    <div key={m.m} className="cal-month" style={{ left: m.left + "%", width: m.width + "%" }}>{LUNI_RO[parseD(m.m).getMonth()].slice(0, luni > 6 ? 3 : 20)}{parseD(m.m).getMonth() === 0 || m.m === start ? " " + parseD(m.m).getFullYear() : ""}</div>
                  ))}
                </div>
              </div>
              <div className="cal-body">
                <div className="cal-overlay">
                  {luniHeader.map((m) => <div key={m.m} className="cal-vline" style={{ left: m.left + "%" }} />)}
                  {azi >= start && azi < end && <div className="cal-today" style={{ left: pos(azi) + "%" }}><span>azi</span></div>}
                </div>
                {grupe.map((g) => (
                  <div key={g.cat}>
                    <div className="cal-group"><span className="cal-dot" style={{ background: culoareCategorie(g.cat) }} /> {g.cat} <span className="muted">({g.lista.length})</span></div>
                    {g.lista.map((p) => {
                      const b = bara(p.dataStart, p.dataFinal);
                      const est = oreEstimateProiect(p);
                      const pont = ore[p.id] || 0;
                      const intarziat = p.stadiu !== "Finalizat" && p.dataFinal < azi;
                      const culoare = culoareCategorie(p.categorie);
                      const acts = (p.activitatiGantt || []).filter((a) => a.dataStart && a.dataFinal);
                      const open = !!deschise[p.id];
                      return (
                        <div key={p.id}>
                          <div className="cal-row">
                            <div className="cal-label">
                              {acts.length > 0
                                ? <button className="cal-chev" onClick={() => setDeschise({ ...deschise, [p.id]: !open })} title="Arată activitățile">{open ? "▾" : "▸"}</button>
                                : <span className="cal-chev-sp" />}
                              <div style={{ minWidth: 0 }}>
                                <div className="cell-title cal-ellipsis">{p.nume}</div>
                                <div className="cell-sub cal-ellipsis">{clientName(p.clientId)} · {fmtOre(pont)}{est.ore > 0 ? " / " + fmtOre(est.ore) : ""} h</div>
                              </div>
                            </div>
                            <div className="cal-track">
                              <div className={`cal-bar ${intarziat ? "late" : ""}`} style={{ left: b.left, width: b.width, background: culoare + "33", borderColor: intarziat ? "#B3261E" : culoare, borderLeftStyle: b.taiatStanga ? "dashed" : "solid", borderRightStyle: b.taiatDreapta ? "dashed" : "solid" }}
                                title={`${p.nume}\n${fmtDate(p.dataStart)} – ${fmtDate(p.dataFinal)}\nExecuție: ${Number(p.procentExecutie) || 0}%\nOre pontate: ${fmtOre(pont)}${est.ore > 0 ? " din " + fmtOre(est.ore) : ""}${intarziat ? "\nÎNTÂRZIAT" : ""}`}>
                                <div className="cal-bar-fill" style={{ width: (Number(p.procentExecutie) || 0) + "%", background: culoare }} />
                                <span className="cal-bar-label">{Number(p.procentExecutie) || 0}%{intarziat ? " · întârziat" : ""}</span>
                              </div>
                            </div>
                          </div>
                          {open && acts.map((a) => {
                            if (a.dataFinal < start || a.dataStart >= end) return null;
                            const ba = bara(a.dataStart, a.dataFinal);
                            return (
                              <div className="cal-row cal-sub" key={a.id}>
                                <div className="cal-label"><span className="cal-chev-sp" /><div className="cell-sub cal-ellipsis">↳ {a.denumire}{a.angajatId ? " · " + angajatName(a.angajatId) : ""}</div></div>
                                <div className="cal-track">
                                  <div className="cal-bar thin" style={{ left: ba.left, width: ba.width, background: culoare + "22", borderColor: culoare }} title={`${a.denumire}\n${fmtDate(a.dataStart)} – ${fmtDate(a.dataFinal)}\n${a.procent || 0}%`}>
                                    <div className="cal-bar-fill" style={{ width: (Number(a.procent) || 0) + "%", background: culoare, opacity: 0.6 }} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Bara colorată plină = procentul de execuție. Linia verticală marchează ziua de azi; marginile punctate înseamnă că lucrarea continuă dincolo de perioada afișată. Apasă ▸ pentru a vedea activitățile unei lucrări.</div>
        </Card>
      )}
      {inAfara > 0 && <div className="hint-block">{inAfara} {inAfara === 1 ? "lucrare programată este" : "lucrări programate sunt"} în afara perioadei afișate.</div>}
      {faraDate.length > 0 && (
        <Card title={`Fără date programate (${faraDate.length})`}>
          <div className="hint-block" style={{ marginBottom: 8 }}>Aceste lucrări nu apar în grafic fiindcă nu au completate data de start și data de finalizare. Le completezi din modulul Lucrări (Editează).</div>
          <div className="cal-chips">{faraDate.map((p) => <span key={p.id} className="badge tone-neutral">{p.nume}</span>)}</div>
        </Card>
      )}
    </div>
  );
}

/* ---------- 2. Pontaj pe zile ---------- */
function CalPontaj({ data }) {
  const { update } = useData();
  const toast = useToast();
  const azi = dStr(new Date());
  const [luna, setLuna] = useState(azi.slice(0, 7));
  const [modal, setModal] = useState(null); // { angajatId, data }
  const an = Number(luna.slice(0, 4)), lunaNr = Number(luna.slice(5, 7));
  const nrZile = new Date(an, lunaNr, 0).getDate();
  const sarb = useMemo(() => romanianHolidays(an), [an]);
  const zile = Array.from({ length: nrZile }, (_, i) => {
    const iso = `${luna}-${String(i + 1).padStart(2, "0")}`;
    const dow = parseD(iso).getDay();
    return { n: i + 1, iso, dow, off: dow === 0 || dow === 6 || sarb.has(iso) };
  });
  const pontaje = (data.pontaje || []).filter((x) => (x.data || "").slice(0, 7) === luna);
  const pontMap = {};
  pontaje.forEach((x) => {
    const k = x.angajatId + "|" + x.data;
    (pontMap[k] = pontMap[k] || []).push(x);
  });
  const proiectName = (id) => data.proiecte.find((p) => p.id === id)?.nume || "—";
  const angajati = data.angajati.filter((a) => a.activ !== false || pontaje.some((x) => x.angajatId === a.id));
  const concediiDe = (angId, iso) => (data.concedii || []).find((c) => c.angajatId === angId && c.status !== "Respins" && c.dataStart <= iso && iso <= c.dataFinal);

  const totaluriZi = zile.map((z) => pontaje.filter((x) => x.data === z.iso).reduce((s, x) => s + (Number(x.ore) || 0), 0));
  const orePeLucrare = {};
  pontaje.forEach((x) => { orePeLucrare[x.proiectId] = (orePeLucrare[x.proiectId] || 0) + (Number(x.ore) || 0); });

  function addPontaj(p) {
    update((d) => { d.pontaje = d.pontaje || []; d.pontaje.push({ id: uid(), angajatId: p.angajatId, proiectId: p.proiectId, data: p.data, ore: Number(p.ore) || 0 }); return d; });
    toast("Pontaj înregistrat.");
    setModal(null);
  }
  function stergePontaj(id) {
    update((d) => { d.pontaje = (d.pontaje || []).filter((x) => x.id !== id); return d; });
    toast("Pontaj șters.", "warn");
  }

  const modalItems = modal ? (data.pontaje || []).filter((x) => x.angajatId === modal.angajatId && x.data === modal.data) : [];

  return (
    <div className="stack-md">
      <CalNav>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => setLuna(addLuni(luna + "-01", -1).slice(0, 7))}>‹</Button>
          <strong style={{ minWidth: 150, textAlign: "center" }}>{LUNI_RO[lunaNr - 1]} {an}</strong>
          <Button size="sm" variant="ghost" onClick={() => setLuna(addLuni(luna + "-01", 1).slice(0, 7))}>›</Button>
          <Button size="sm" variant="ghost" onClick={() => setLuna(azi.slice(0, 7))}>Luna curentă</Button>
        </div>
        <div className="cal-legend">
          <span><i className="cal-sw cal-ok" /> 8 h sau mai mult</span>
          <span><i className="cal-sw cal-low" /> sub 8 h</span>
          <span><i className="cal-sw cal-co" /> CO</span>
          <span><i className="cal-sw cal-cm" /> CM</span>
          <span><i className="cal-sw cal-pend" /> cerere în așteptare</span>
          <span><i className="cal-sw cal-off" /> weekend / sărbătoare</span>
        </div>
      </CalNav>

      {angajati.length === 0 ? <EmptyState text="Niciun angajat în evidență." /> : (
        <Card>
          <div className="cal-scroll">
            <table className="cal-pontaj">
              <thead>
                <tr>
                  <th className="cal-stick">Angajat</th>
                  <th className="cal-tot">Total</th>
                  <th className="cal-tot">Nepont.</th>
                  {zile.map((z) => <th key={z.iso} className={`cal-day ${z.off ? "cal-off" : ""} ${z.iso === azi ? "cal-azi" : ""}`}><div>{z.n}</div><div className="cal-dow">{ZILE_SC[z.dow]}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {angajati.map((a) => {
                  let total = 0, nepontate = 0;
                  const celule = zile.map((z) => {
                    const items = pontMap[a.id + "|" + z.iso] || [];
                    const ore = items.reduce((s, x) => s + (Number(x.ore) || 0), 0);
                    total += ore;
                    const c = concediiDe(a.id, z.iso);
                    let cls = z.off ? "cal-off" : "", txt = "";
                    if (ore > 0) { txt = fmtOre(ore); cls = ore >= 8 ? "cal-ok" : "cal-low"; }
                    else if (c) { txt = c.tip === "Medical" ? "CM" : "CO"; cls = c.status === "Cerere" ? "cal-pend" : c.tip === "Medical" ? "cal-cm" : "cal-co"; }
                    else if (!z.off && z.iso <= azi) nepontate++;
                    const titlu = items.length ? items.map((x) => `${proiectName(x.proiectId)}: ${fmtOre(x.ore)} h`).join("\n") : c ? `${c.tip === "Medical" ? "Concediu medical" : "Concediu de odihnă"}${c.status === "Cerere" ? " (cerere în așteptare)" : ""}` : "";
                    return <td key={z.iso} className={`cal-cell ${cls}`} title={titlu} onClick={() => setModal({ angajatId: a.id, data: z.iso })}>{txt}</td>;
                  });
                  return (
                    <tr key={a.id}>
                      <td className="cal-stick"><div className="cell-title cal-ellipsis">{a.nume}</div></td>
                      <td className="cal-tot mono">{fmtOre(total)}</td>
                      <td className="cal-tot">{nepontate > 0 ? <Badge tone="warn">{nepontate}</Badge> : <span className="muted">0</span>}</td>
                      {celule}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="cal-stick"><b>Total ore / zi</b></td>
                  <td className="cal-tot mono"><b>{fmtOre(totaluriZi.reduce((s, x) => s + x, 0))}</b></td>
                  <td />
                  {totaluriZi.map((t, i) => <td key={i} className={`cal-cell cal-foot ${zile[i].off ? "cal-off" : ""}`}>{t > 0 ? fmtOre(t) : ""}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Apasă pe o celulă ca să adaugi sau să ștergi ore pentru acea zi. „Nepontate” = zile lucrătoare până azi fără ore și fără concediu.</div>
        </Card>
      )}

      <Card title={`Ore pe lucrare — ${LUNI_RO[lunaNr - 1]} ${an}`}>
        {Object.keys(orePeLucrare).length === 0 ? <EmptyState text="Niciun pontaj în luna aleasă." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Lucrare</th><th className="num">Ore în lună</th></tr></thead>
              <tbody>
                {Object.entries(orePeLucrare).sort((a, b) => b[1] - a[1]).map(([id, h]) => <tr key={id}><td>{proiectName(id)}</td><td className="num mono">{fmtOre(h)}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal ? `Pontaj — ${data.angajati.find((a) => a.id === modal.angajatId)?.nume || ""} · ${fmtDate(modal.data)}` : ""}>
        {modal && (
          <div className="stack-md">
            {modalItems.length > 0 && (
              <div className="stack-md">
                {modalItems.map((x) => (
                  <div key={x.id} className="btn-row" style={{ justifyContent: "space-between" }}>
                    <span>{proiectName(x.proiectId)} — <b className="mono">{fmtOre(x.ore)} h</b></span>
                    <button className="link-btn danger" onClick={() => stergePontaj(x.id)}>Șterge</button>
                  </div>
                ))}
              </div>
            )}
            <PontajForm key={modal.angajatId + modal.data} angajati={data.angajati} proiecte={data.proiecte} initial={{ angajatId: modal.angajatId, data: modal.data }} onSave={addPontaj} onCancel={() => setModal(null)} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- 3. Timp de lucru rămas pe lucrare ---------- */
function CalTimp({ data }) {
  const azi = dStr(new Date());
  const [cat, setCat] = useState("");
  const [finalizate, setFinalizate] = useState(false);
  const ore = useMemo(() => orePeProiect(data), [data.pontaje]);
  const clientName = (id) => data.clienti.find((c) => c.id === id)?.nume || "";

  const randuri = data.proiecte
    .filter((p) => (!cat || normCategorie(p.categorie) === cat) && (finalizate || p.stadiu !== "Finalizat"))
    .map((p) => {
      const est = oreEstimateProiect(p);
      const pont = ore[p.id] || 0;
      const exec = Number(p.procentExecutie) || 0;
      const ramase = est.ore > 0 ? est.ore - pont : null;
      const consum = est.ore > 0 ? (pont / est.ore) * 100 : null;
      const zileRamase = p.dataFinal && p.dataFinal >= azi ? calcZileLucratoare(p.dataStart && p.dataStart > azi ? p.dataStart : azi, p.dataFinal) : 0;
      const oreZi = ramase !== null && ramase > 0 && zileRamase > 0 ? ramase / zileRamase : null;
      let stare;
      if (p.stadiu === "Finalizat") stare = { tone: "neutral", label: "Finalizat", ord: 5 };
      else if (est.ore <= 0) stare = { tone: "neutral", label: "Fără estimare ore", ord: 4 };
      else if (pont > est.ore) stare = { tone: "danger", label: "Ore depășite", ord: 0 };
      else if (p.dataFinal && p.dataFinal < azi) stare = { tone: "danger", label: "Întârziat", ord: 1 };
      else if (consum > exec + 15) stare = { tone: "warn", label: "Consum peste ritm", ord: 2 };
      else stare = { tone: "ok", label: "În grafic", ord: 3 };
      return { p, est, pont, exec, ramase, consum, zileRamase, oreZi, stare };
    })
    .sort((a, b) => a.stare.ord - b.stare.ord || (a.p.dataFinal || "9999").localeCompare(b.p.dataFinal || "9999"));

  const activ = randuri.filter((r) => r.p.stadiu !== "Finalizat");
  const totEst = activ.reduce((s, r) => s + r.est.ore, 0);
  const totPont = activ.reduce((s, r) => s + r.pont, 0);
  const totRamase = activ.reduce((s, r) => s + (r.ramase !== null && r.ramase > 0 ? r.ramase : 0), 0);
  const probleme = randuri.filter((r) => r.stare.tone === "danger" || r.stare.tone === "warn").length;

  return (
    <div className="stack-md">
      <div className="grid-4">
        <Card><div className="kpi-label">Ore estimate (lucrări active)</div><div className="kpi-value mono">{fmtOre(totEst)}</div><div className="kpi-sub">din devize sau introduse manual</div></Card>
        <Card><div className="kpi-label">Ore pontate</div><div className="kpi-value mono">{fmtOre(totPont)}</div><div className="kpi-sub">pe lucrările active</div></Card>
        <Card><div className="kpi-label">Ore rămase</div><div className="kpi-value mono">{fmtOre(totRamase)}</div><div className="kpi-sub">estimate minus pontate</div></Card>
        <Card><div className="kpi-label">Lucrări de urmărit</div><div className={`kpi-value ${probleme ? "text-danger" : ""}`}>{probleme}</div><div className="kpi-sub">ore depășite, întârziate sau peste ritm</div></Card>
      </div>
      <CalNav>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categorie">
            <option value="">Toate categoriile</option>
            {CATEGORII_PROIECT.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="cal-check"><input type="checkbox" checked={finalizate} onChange={(e) => setFinalizate(e.target.checked)} /> Arată și lucrările finalizate</label>
        </div>
      </CalNav>
      {randuri.length === 0 ? <EmptyState text="Nicio lucrare de afișat." /> : (
        <Card>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Lucrare</th><th>Perioadă</th><th className="num">Ore estimate</th><th className="num">Ore pontate</th><th className="num">Ore rămase</th><th>Consum ore vs. execuție</th><th className="num">Ore/zi necesare</th><th>Stare</th></tr>
              </thead>
              <tbody>
                {randuri.map((r) => (
                  <tr key={r.p.id}>
                    <td><div className="cell-title">{r.p.nume}</div><div className="cell-sub">{clientName(r.p.clientId)} · {normCategorie(r.p.categorie)}</div></td>
                    <td>{r.p.dataStart || r.p.dataFinal ? <><div>{fmtDate(r.p.dataStart)} – {fmtDate(r.p.dataFinal)}</div><div className="cell-sub">{r.zileRamase > 0 ? `${r.zileRamase} zile lucrătoare rămase` : r.p.dataFinal && r.p.dataFinal < azi && r.p.stadiu !== "Finalizat" ? `termen depășit cu ${diffZile(r.p.dataFinal, azi)} zile` : ""}</div></> : <span className="muted">—</span>}</td>
                    <td className="num mono">{r.est.ore > 0 ? fmtOre(r.est.ore) : "—"}{r.est.ore > 0 && <div className="cell-sub">{r.est.sursa === "manual" ? "manual" : "din devize"}</div>}</td>
                    <td className="num mono">{fmtOre(r.pont)}</td>
                    <td className={`num mono ${r.ramase !== null && r.ramase < 0 ? "text-danger" : ""}`}>{r.ramase === null ? "—" : fmtOre(r.ramase)}</td>
                    <td style={{ minWidth: 150 }}>
                      {r.consum === null ? <span className="muted">—</span> : (
                        <div className="cal-mini">
                          <div className="cal-mini-row"><span>ore</span><div className="cal-mini-track"><div style={{ width: Math.min(100, r.consum) + "%", background: r.consum > 100 ? "#B3261E" : "#C77D12" }} /></div><span className="mono">{Math.round(r.consum)}%</span></div>
                          <div className="cal-mini-row"><span>exec.</span><div className="cal-mini-track"><div style={{ width: r.exec + "%", background: "#2E6F9E" }} /></div><span className="mono">{Math.round(r.exec)}%</span></div>
                        </div>
                      )}
                    </td>
                    <td className="num mono">{r.oreZi !== null ? fmtOre(r.oreZi) : "—"}</td>
                    <td><Badge tone={r.stare.tone}>{r.stare.label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint-block" style={{ marginTop: 10 }}>Orele estimate se iau din liniile de manoperă (în ore) ale devizelor: devizul final, dacă există, altfel cel inițial plus cele suplimentare. Pentru o lucrare le poți introduce și manual, în modulul Lucrări → Editează → „Ore estimate (manual)”. „Consum peste ritm” înseamnă că s-a consumat din ore cu mai mult de 15 puncte procentuale peste progresul de execuție.</div>
        </Card>
      )}
    </div>
  );
}

function ModuleCalendar() {
  const { rol } = useData();
  const areAngajati = rol === "admin" || rol === "birou";
  const taburi = [{ key: "gantt", label: "Lucrări (Gantt)" }, ...(areAngajati ? [{ key: "pontaj", label: "Pontaj pe zile" }] : []), { key: "timp", label: "Timp rămas" }];
  const [tab, setTab] = useState("gantt");
  const { data } = useData();
  return (
    <div className="stack-lg">
      <div className="tab-row">
        {taburi.map((t) => <button key={t.key} type="button" className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab === "gantt" && <CalGantt data={data} />}
      {tab === "pontaj" && areAngajati && <CalPontaj data={data} />}
      {tab === "timp" && <CalTimp data={data} />}
    </div>
  );
}

function Shell({ onSignOut, userEmail }) {
  const [tab, setTab] = useState("dashboard");
  const { status, reset, rol } = useData();
  const sec = useSec();
  const navPerm = NAV.filter((n) => (NAV_ROL[rol] || NAV_ROL.tehnician).includes(n.key));
  const activeKey = navPerm.some((n) => n.key === tab) ? tab : navPerm[0].key;
  const active = navPerm.find((n) => n.key === activeKey);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  function selecteazaTab(key) {
    setTab(key);
    setNavOpen(false);
  }

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">NP</div>
          <div className="brand-text">
            <div className="brand-name">NOVATECH</div>
            <div className="brand-sub">PROIECT SRL</div>
          </div>
          <button className="icon-btn sidebar-close" onClick={() => setNavOpen(false)} title="Închide meniul"><IconX size={16} /></button>
        </div>
        <nav className="sidebar-nav">
          {navPerm.map((n) => (
            <button key={n.key} className={`nav-item ${activeKey === n.key ? "active" : ""}`} onClick={() => selecteazaTab(n.key)}>
              <n.Icon size={17} /> <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {userEmail && <div className="sidebar-user">{userEmail}<br />{ROLURI[rol] || rol}</div>}
          {onSignOut && (
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <button className="link-btn muted" onClick={sec.blocheaza}>Blochează</button>
              <button className="link-btn muted" onClick={onSignOut}>Deconectare</button>
            </div>
          )}
          {supabaseConfigured ? null : !resetConfirm ? (
            <button className="link-btn muted" onClick={() => setResetConfirm(true)}>Resetează datele demo</button>
          ) : (
            <span className="confirm-inline stacked">
              <span>Sigur? Se pierd datele curente.</span>
              <span>
                <button className="link-btn danger" onClick={() => { reset(); setResetConfirm(false); }}>Da, resetează</button>
                <button className="link-btn" onClick={() => setResetConfirm(false)}>Anulează</button>
              </span>
            </span>
          )}
        </div>
      </aside>
      {navOpen && <div className="sidebar-overlay" onClick={() => setNavOpen(false)} />}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-btn" onClick={() => setNavOpen(true)} title="Meniu"><IconMenu size={19} /></button>
            <h1>{active.label}</h1>
          </div>
          <div className={`save-indicator ${status}`}>
            {status === "saving" && <><IconClock size={14} /> <span className="save-text">Se salvează…</span></>}
            {status === "ready" && <><IconCheck size={14} /> <span className="save-text">Sincronizat</span></>}
            {status === "error" && <><IconAlert size={14} /> <span className="save-text">Eroare la salvare</span></>}
          </div>
        </header>
        <main className="content">
          <active.View />
        </main>
      </div>
      {!aiOpen && !supabaseConfigured && (
        <button className="ai-fab" onClick={() => setAiOpen(true)} title="Asistent AI">
          <IconAI size={22} />
        </button>
      )}
      <AsistentAI open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

/* =========================================================================
   ROOT
   ========================================================================= */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.novatech-root {
  --bg: #EEF1F4;
  --surface: #FFFFFF;
  --ink: #16232E;
  --ink-soft: #4C5C6B;
  --line: #D2D9E0;
  --blueprint: #123A5C;
  --blueprint-2: #1D5A8A;
  --signal: #E1670E;
  --signal-soft: #FCE7D6;
  --ok: #2F7D4F;
  --ok-soft: #E1F0E6;
  --warn: #B8790A;
  --warn-soft: #FBEDD3;
  --danger: #B23B3B;
  --danger-soft: #F8E2E2;
  font-family: 'IBM Plex Sans', -apple-system, sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
  font-size: 14px;
  line-height: 1.45;
}
.novatech-root * { box-sizing: border-box; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }

.app-shell { display: flex; min-height: 100vh; }

.sidebar {
  width: 236px; flex-shrink: 0; background: var(--blueprint);
  background-image:
    linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)),
    radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: auto, 16px 16px;
  color: #DCE7EF; display: flex; flex-direction: column;
  padding: 20px 14px; padding-top: calc(20px + env(safe-area-inset-top));
  position: sticky; top: 0; height: 100vh;
}
.sidebar-brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 22px; border-bottom: 1px solid rgba(255,255,255,0.12); margin-bottom: 14px; }
.sidebar-close { display: none; margin-left: auto; background: transparent; border-color: rgba(255,255,255,0.25); color: #DCE7EF; }
.brand-mark {
  width: 34px; height: 34px; border-radius: 4px; background: var(--signal); color: #fff;
  display: flex; align-items: center; justify-content: center; font-family: 'IBM Plex Mono', monospace;
  font-weight: 600; font-size: 13px; letter-spacing: 0.5px;
}
.brand-name { font-weight: 700; font-size: 14.5px; letter-spacing: 0.6px; }
.brand-sub { font-size: 10.5px; color: #9FB4C6; letter-spacing: 1.2px; }

.sidebar-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px;
  background: transparent; border: none; color: #B9CBDA; text-align: left; cursor: pointer;
  font-size: 13.2px; font-family: inherit; transition: background 0.12s, color 0.12s;
}
.nav-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-item.active { background: rgba(225,103,14,0.18); color: #fff; box-shadow: inset 2px 0 0 var(--signal); }
.sidebar-foot { padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.12); }

.app-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  display: flex; align-items: center; justify-content: space-between; padding: 18px 28px;
  padding-top: calc(18px + env(safe-area-inset-top));
  background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5;
  gap: 12px;
}
.topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.topbar h1 { font-size: 18px; font-weight: 700; margin: 0; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-btn {
  display: none; flex-shrink: 0; width: 34px; height: 34px; align-items: center; justify-content: center;
  border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer;
}
.save-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-soft); flex-shrink: 0; }
.save-indicator.error { color: var(--danger); }
.sidebar-overlay { display: none; }

.content { padding: 24px 28px 60px; max-width: 1240px; width: 100%; margin: 0 auto; }

.stack-lg { display: flex; flex-direction: column; gap: 20px; }
.stack-md { display: flex; flex-direction: column; gap: 14px; }

.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 980px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } }

.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px;
  position: relative; overflow-x: auto;
}
.bracket { position: absolute; width: 9px; height: 9px; border-color: var(--signal); opacity: 0.55; }
.bracket-tl { top: 6px; left: 6px; border-top: 2px solid var(--signal); border-left: 2px solid var(--signal); }
.bracket-br { bottom: 6px; right: 6px; border-bottom: 2px solid var(--signal); border-right: 2px solid var(--signal); }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.card-head h3 { font-size: 13.5px; font-weight: 600; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink-soft); }

.kpi-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink-soft); font-weight: 600; margin-bottom: 8px; }
.kpi-value { font-size: 25px; font-weight: 700; letter-spacing: -0.2px; }
.kpi-sub { font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
.text-danger { color: var(--danger); }
.text-ok { color: var(--ok); }
.text-warn { color: var(--warn); }

.section-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.section-intro { color: var(--ink-soft); font-size: 13px; margin: 0; max-width: 60ch; }
.btn-row { display: flex; gap: 8px; align-items: center; }

.btn {
  display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; border: 1px solid transparent;
  font-family: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: filter 0.12s, background 0.12s;
}
.btn-md { padding: 9px 14px; font-size: 13px; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-primary { background: var(--signal); color: #fff; }
.btn-primary:hover { filter: brightness(1.06); }
.btn-ghost { background: var(--surface); color: var(--ink); border-color: var(--line); }
.btn-ghost:hover { background: #F5F7F9; }
.btn-ok { background: var(--ok); color: #fff; }
.btn-danger { background: var(--danger); color: #fff; }
.checkbox-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 10px; }

.tab-row { display: flex; gap: 4px; background: #E9EDF1; padding: 3px; border-radius: 8px; }
.tab-btn {
  font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 6px; border: none;
  background: transparent; color: var(--ink-soft); cursor: pointer; transition: background 0.12s, color 0.12s;
}
.tab-btn:hover { color: var(--ink); }
.tab-btn.active { background: var(--surface); color: var(--blueprint); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.fisa-kpi { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)) !important; gap: 10px; }
.fisa-kpi .kpi-value { font-size: 17px !important; overflow-wrap: anywhere; }

.icon-btn {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft); cursor: pointer;
}
.icon-btn:hover { color: var(--ink); background: #F5F7F9; }

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--ink-soft);
  padding: 8px 10px; border-bottom: 1px solid var(--line); font-weight: 600;
}
.table td { padding: 11px 10px; border-bottom: 1px solid #EEF1F4; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table .num { text-align: right; }
.table .actions { display: flex; gap: 4px; justify-content: flex-end; }
.cell-title { font-weight: 600; }
.cell-sub { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.muted { color: #A6B1BB; }

.badge {
  display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px;
  font-weight: 600; white-space: nowrap;
}
.tone-neutral { background: #EEF1F4; color: var(--ink-soft); }
.tone-accent { background: #DCEAF4; color: var(--blueprint-2); }
.tone-ok { background: var(--ok-soft); color: var(--ok); }
.tone-warn { background: var(--warn-soft); color: var(--warn); }
.tone-danger { background: var(--danger-soft); color: var(--danger); }
.badge-btn { background: none; border: none; cursor: pointer; padding: 0; }

.mini-bar { width: 110px; height: 6px; border-radius: 3px; background: #EEF1F4; overflow: hidden; margin-bottom: 3px; }
.mini-bar-fill { height: 100%; background: var(--blueprint-2); }

.bar-row-head { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 5px; }
.bar-track { height: 9px; border-radius: 4px; background: #E3E8ED; min-width: 40%; }
.bar-fill { height: 100%; border-radius: 4px; background: var(--blueprint-2); }

.alert-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.alert-list li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.alert-tip { font-weight: 600; color: var(--ink-soft); min-width: 74px; }
.alert-text { flex: 1; }

.request-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.request-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid #EEF1F4; }
.request-list li:last-child { border-bottom: none; padding-bottom: 0; }

.empty-state { color: var(--ink-soft); font-size: 13px; padding: 18px 4px; text-align: center; }

.warn-card { border-color: var(--warn); background: var(--warn-soft); }
.warn-card-inner { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #6B4A0A; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(15,25,35,0.45); display: flex; align-items: center;
  justify-content: center; z-index: 50; padding: 20px;
}
.modal-panel { background: var(--surface); border-radius: 10px; width: 460px; max-width: 100%; max-height: 88vh; overflow: auto; transition: width 0.15s, height 0.15s; }
.modal-panel.wide { width: 620px; }
.modal-panel.maximized { width: 96vw; height: 92vh; max-width: 96vw; max-height: 92vh; }
.modal-panel.minimized { width: 260px; max-height: none; overflow: visible; }
.modal-panel.minimized .modal-body { display: none; }
.modal-overlay.overlay-minimized { align-items: flex-end; justify-content: flex-end; background: transparent; pointer-events: none; }
.modal-overlay.overlay-minimized .modal-panel { pointer-events: auto; margin: 0 16px 16px 0; box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
.win-controls { display: flex; gap: 4px; flex-shrink: 0; }
.win-btn { width: 26px; height: 26px; }
.win-close:hover { background: var(--danger-soft); color: var(--danger); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-body { padding: 20px; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-grid .field:has(textarea) { grid-column: 1 / -1; }
.form-grid .field.field-wide { grid-column: 1 / -1; }
.form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
.field input, .field select, .field textarea {
  font-family: inherit; font-size: 13.5px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line);
  color: var(--ink); font-weight: 400; background: #FBFCFD;
}
.field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid var(--blueprint-2); outline-offset: 0; }
.field-hint { font-size: 10.8px; font-weight: 400; color: #93A0AB; }
.hint-block { grid-column: 1 / -1; font-size: 12.5px; color: var(--ink-soft); background: #F5F7F9; padding: 8px 10px; border-radius: 6px; }

.confirm-inline { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-soft); white-space: nowrap; }
.confirm-inline.stacked { flex-direction: column; align-items: flex-start; gap: 4px; }
.link-btn { background: none; border: none; padding: 0; font-family: inherit; font-size: 12px; font-weight: 600; color: var(--blueprint-2); cursor: pointer; text-decoration: underline; }
.link-btn.danger { color: var(--danger); }
.link-btn.muted { color: #8FA6B8; }

.toast-stack { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100; }
.toast { padding: 10px 16px; border-radius: 6px; background: var(--ink); color: #fff; font-size: 12.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
.toast.tone-warn { background: var(--warn); }
.toast.tone-danger { background: var(--danger); }

.loading-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--ink-soft); font-size: 13px; }

.login-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); padding: 20px; }

/* ---- Calendar ---- */
.cal-toolbar { flex-wrap: wrap; gap: 10px; align-items: center; }
.cal-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.cal-scroll { overflow-x: auto; }
.cal-grid { min-width: 860px; }
.cal-row { display: grid; grid-template-columns: 230px 1fr; align-items: center; min-height: 40px; }
.cal-row.cal-sub { min-height: 28px; }
.cal-head { min-height: 26px; border-bottom: 1px solid var(--line); }
.cal-label { position: sticky; left: 0; z-index: 3; background: var(--surface); display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 0; min-width: 0; }
.cal-track { position: relative; height: 30px; }
.cal-months { height: 24px; }
.cal-month { position: absolute; top: 4px; font-size: 11px; font-weight: 600; color: var(--ink-soft); padding-left: 4px; white-space: nowrap; overflow: hidden; }
.cal-body { position: relative; }
.cal-overlay { position: absolute; top: 0; bottom: 0; left: 230px; right: 0; pointer-events: none; z-index: 1; }
.cal-vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line); }
.cal-today { position: absolute; top: 0; bottom: 0; width: 2px; background: #B3261E; opacity: 0.75; }
.cal-today span { position: absolute; top: 0; left: 4px; font-size: 9px; font-weight: 700; color: #B3261E; }
.cal-group { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); padding: 10px 0 4px; position: sticky; left: 0; }
.cal-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
.cal-bar { position: absolute; top: 3px; height: 24px; border: 1px solid; border-radius: 4px; overflow: hidden; z-index: 2; box-sizing: border-box; display: flex; align-items: center; }
.cal-bar.thin { top: 8px; height: 12px; }
.cal-bar.late { box-shadow: 0 0 0 1px #B3261E; }
.cal-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; opacity: 0.85; }
.cal-bar-label { position: relative; z-index: 1; font-size: 10.5px; font-weight: 700; color: var(--ink); padding-left: 6px; white-space: nowrap; text-shadow: 0 0 3px #fff, 0 0 3px #fff; }
.cal-chev { background: none; border: none; cursor: pointer; width: 16px; padding: 0; color: var(--ink-soft); flex: none; }
.cal-chev-sp { display: inline-block; width: 16px; flex: none; }
.cal-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cal-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--ink-soft); }
.cal-sw { display: inline-block; width: 12px; height: 12px; border: 1px solid var(--line); vertical-align: -2px; margin-right: 4px; }
.cal-pontaj { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; }
.cal-pontaj th, .cal-pontaj td { border-bottom: 1px solid var(--line); border-right: 1px solid #EEF1F4; padding: 0; text-align: center; }
.cal-pontaj .cal-stick { position: sticky; left: 0; z-index: 2; background: var(--surface); text-align: left; padding: 6px 10px; min-width: 150px; max-width: 170px; }
.cal-pontaj .cal-day { min-width: 28px; font-weight: 600; padding: 3px 0; }
.cal-dow { font-size: 9px; color: var(--ink-soft); font-weight: 500; }
.cal-pontaj .cal-cell { min-width: 28px; height: 30px; cursor: pointer; font-family: "IBM Plex Mono", monospace; font-size: 11.5px; }
.cal-pontaj .cal-cell:hover { outline: 2px solid var(--blueprint-2); outline-offset: -2px; }
.cal-pontaj .cal-foot { cursor: default; font-weight: 600; }
.cal-pontaj .cal-tot { min-width: 54px; padding: 6px 8px; text-align: right; background: #F7F9FB; }
.cal-ok { background: #CDE9D6; }
.cal-low { background: #FBE7B5; }
.cal-co { background: #CFE3F5; }
.cal-cm { background: #F3D1D1; }
.cal-pend { background: repeating-linear-gradient(45deg, #DCE9F6, #DCE9F6 4px, #FFFFFF 4px, #FFFFFF 8px); }
.cal-off { background: #EEF1F4; }
.cal-pontaj .cal-azi { box-shadow: inset 0 -2px 0 #B3261E; }
.cal-mini { display: flex; flex-direction: column; gap: 4px; }
.cal-mini-row { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
.cal-mini-row > span:first-child { width: 30px; color: var(--ink-soft); }
.cal-mini-track { flex: 1; height: 6px; background: #E3E8ED; border-radius: 3px; overflow: hidden; }
.cal-mini-track > div { height: 100%; }
@media (max-width: 700px) {
  .cal-row { grid-template-columns: 140px 1fr; }
  .cal-overlay { left: 140px; }
}

.login-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 32px 28px;
  width: 100%; max-width: 340px; box-shadow: 0 10px 40px rgba(15,40,60,0.12);
}
.login-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.login-brand .brand-name, .login-brand .brand-sub { color: var(--ink); }
.login-brand .brand-sub { color: var(--ink-soft); }
.login-card h2 { font-size: 16px; margin: 0 0 16px; color: var(--ink); }
.login-error { display: flex; align-items: center; gap: 6px; color: var(--danger); font-size: 12.5px; margin: 4px 0 14px; }
.sidebar-user { font-size: 11.5px; color: rgba(255,255,255,0.55); padding: 0 8px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.gantt-chart { display: flex; flex-direction: column; gap: 8px; margin-bottom: 6px; }
.gantt-row { display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 10px; }
.gantt-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-track { position: relative; height: 22px; background: #EEF1F4; border-radius: 4px; }
.gantt-bar { position: absolute; top: 2px; height: 18px; border-radius: 4px; background: #DCEAF4; border: 1px solid var(--blueprint-2); overflow: hidden; display: flex; align-items: center; }
.gantt-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--blueprint-2); opacity: 0.85; }
.gantt-bar-label { position: relative; z-index: 1; font-size: 10px; font-weight: 600; color: var(--ink); padding-left: 6px; white-space: nowrap; }

.ai-fab {
  position: fixed; bottom: calc(24px + env(safe-area-inset-bottom)); right: 24px; width: 54px; height: 54px; border-radius: 50%;
  background: var(--signal); color: #fff; border: none; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(0,0,0,0.25); cursor: pointer; z-index: 60;
}
.ai-fab:hover { filter: brightness(1.08); }
.ai-panel {
  position: fixed; bottom: calc(24px + env(safe-area-inset-bottom)); right: 24px; width: 360px; height: 480px; max-height: 80vh;
  background: var(--surface); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.28);
  display: flex; flex-direction: column; z-index: 60; overflow: hidden; border: 1px solid var(--line);
}
.ai-panel-head {
  background: var(--blueprint); color: #fff; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
  font-size: 13.5px; font-weight: 600;
}
.ai-panel-head .icon-btn { background: transparent; border-color: rgba(255,255,255,0.3); color: #fff; }
.ai-panel-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.ai-msg { font-size: 13px; padding: 8px 11px; border-radius: 8px; max-width: 85%; line-height: 1.4; white-space: pre-wrap; }
.ai-msg-user { align-self: flex-end; background: var(--blueprint-2); color: #fff; }
.ai-msg-assistant { align-self: flex-start; background: #F0F3F6; color: var(--ink); }
.ai-msg-error { align-self: center; background: var(--danger-soft); color: var(--danger); font-size: 12px; }
.ai-typing { font-style: italic; color: var(--ink-soft); }
.ai-panel-input { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--line); }
.ai-panel-input input { flex: 1; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line); }

/* ---------------------------- Mobil ---------------------------- */
@media (max-width: 860px) {
  .sidebar {
    position: fixed; top: 0; left: 0; height: 100vh; width: 80vw; max-width: 300px;
    z-index: 80; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 10px 0 30px rgba(0,0,0,0.3);
  }
  .app-shell.nav-open .sidebar { transform: translateX(0); }
  .sidebar-close { display: inline-flex; }
  .sidebar-overlay { display: block; position: fixed; inset: 0; background: rgba(15,25,35,0.5); z-index: 75; }
  .menu-btn { display: inline-flex; }

  .content { padding: 16px 14px 60px; }
  .topbar { padding: 12px 14px; padding-top: calc(12px + env(safe-area-inset-top)); }
  .topbar h1 { font-size: 15.5px; }
  .save-text { display: none; }

  .form-grid { grid-template-columns: 1fr; }
  .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }

  .modal-overlay { padding: 0; align-items: flex-end; }
  .modal-panel, .modal-panel.wide { width: 100vw; max-width: 100vw; border-radius: 14px 14px 0 0; max-height: 92vh; }
  .modal-panel.maximized { width: 100vw; height: 96vh; max-width: 100vw; max-height: 96vh; }

  .table th, .table td { padding: 8px 7px; font-size: 12px; }
  .section-toolbar { flex-direction: column; align-items: stretch; }
  .section-toolbar .btn-row { flex-wrap: wrap; }

  .tab-row { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tab-btn { white-space: nowrap; }

  .gantt-row { grid-template-columns: 108px 1fr; gap: 6px; }
  .gantt-label { font-size: 10.5px; }

  .ai-panel { width: 94vw; height: 78vh; right: 3vw; bottom: calc(8px + env(safe-area-inset-bottom)); }
  .ai-fab { bottom: calc(18px + env(safe-area-inset-bottom)); right: 18px; }

  .kpi-value { font-size: 21px; }
}
`;

export default function NovatechApp() {
  const { session, authError, signIn, signOut, acces, reevalueaza } = useAuth();
  const rol = acces.stare === "ok" ? acces.rol : undefined;
  const store = usePersistentData(rol);
  const [blocat, setBlocat] = useState(false);
  useIdleLock(supabaseConfigured && acces.stare === "ok" && !blocat, MINUTE_BLOCARE, () => setBlocat(true));
  useEffect(() => { if (acces.stare !== "ok") setBlocat(false); }, [acces.stare]);
  const secVal = useMemo(
    () => ({ rol, mfaActiv: !!acces.mfaActiv, factorId: acces.factorId || null, session, reevalueaza, blocheaza: () => setBlocat(true) }),
    [rol, acces.mfaActiv, acces.factorId, session, reevalueaza]
  );
  const ecran = (continut) => (
    <div className="novatech-root">
      <style>{STYLES}</style>
      {continut}
    </div>
  );

  if (supabaseConfigured && session === undefined) return ecran(<div className="loading-screen">Se verifică autentificarea…</div>);
  if (supabaseConfigured && session === null) return ecran(<LoginScreen onSignIn={signIn} error={authError} />);
  if (supabaseConfigured && acces.stare === "verific") return ecran(<div className="loading-screen">Se verifică accesul…</div>);
  if (supabaseConfigured && acces.stare === "mfa") return ecran(<MfaChallenge factorId={acces.factorId} onDone={reevalueaza} onSignOut={signOut} />);
  if (supabaseConfigured && (acces.stare === "fara-rol" || acces.stare === "eroare")) return ecran(<BlocajAcces stare={acces.stare} mesaj={acces.mesaj} onSignOut={signOut} />);
  if (store.data === null) {
    if (store.status === "error") return ecran(<EroareIncarcare eroare={store.eroare} onSignOut={signOut} />);
    return ecran(<div className="loading-screen">Se încarcă datele Novatech…</div>);
  }
  if (blocat) {
    return ecran(<LockScreen email={session?.user?.email} factorId={acces.factorId} onUnlock={() => setBlocat(false)} onSignOut={signOut} />);
  }

  return ecran(
    <SecCtx.Provider value={secVal}>
      <DataCtx.Provider value={store}>
        <ToastProvider>
          <Shell onSignOut={supabaseConfigured ? signOut : null} userEmail={session?.user?.email} />
        </ToastProvider>
      </DataCtx.Provider>
    </SecCtx.Provider>
  );
}
