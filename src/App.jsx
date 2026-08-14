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

/* ---------------------------- Autentificare (activă doar când Supabase e configurat) ---------------------------- */

function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = se verifică, null = neautentificat, obiect = autentificat
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) setSession(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email, parola) => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: parola });
    if (error) setAuthError(error.message === "Invalid login credentials" ? "Email sau parolă greșite." : error.message);
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  return { session, authError, signIn, signOut };
}

function LoginScreen({ onSignIn, error }) {
  const [email, setEmail] = useState("");
  const [parola, setParola] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    await onSignIn(email, parola);
    setLoading(false);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-mark">NP</div>
          <div>
            <div className="brand-name">NOVATECH</div>
            <div className="brand-sub">PROIECT SRL</div>
          </div>
        </div>
        <h2>Autentificare</h2>
        <Field label="Email"><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@novatech.ro" /></Field>
        <Field label="Parolă"><input type="password" required value={parola} onChange={(e) => setParola(e.target.value)} placeholder="••••••••" /></Field>
        {error && <div className="login-error"><IconAlert size={15} /> {error}</div>}
        <Button type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Se conectează…" : "Intră în cont"}</Button>
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

function seedData() {
  const c1 = uid(), c2 = uid(), c3 = uid(), c4 = uid(), c5 = uid();
  const p1 = uid(), p2 = uid(), p3 = uid(), p4 = uid(), p5 = uid(), p6 = uid();
  const e1 = uid(), e2 = uid(), e3 = uid(), e4 = uid(), e5 = uid(), e6 = uid();

  return {
    // Date reale preluate din "1. Lucrari.xlsx" și "3. Personal.xlsx" — un subset
    // reprezentativ, nu toate cele 52 de devize din centralizator.
    clienti: [
      { id: c1, nume: "Kaufland România — mai multe locații", contact: "" },
      { id: c2, nume: "Atalian Sky (Sky Tower)", contact: "" },
      { id: c3, nume: "Amis / Elena Hala", contact: "" },
      { id: c4, nume: "Răzvan Zamfiroiu", contact: "" },
      { id: c5, nume: "Dr. Prirecaru", contact: "" },
    ],
    proiecte: [
      { id: p1, nume: "k291 — Kaufland Pantelimon — condiționare chimică", clientId: c1, categorie: "Kaufland", stadiu: "Contract", procentExecutie: 40,
        valoareOferta: 27775.85, valoareContract: 27775.85, costRealizat: 9000, dataStart: "", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0, devize: [] },
      { id: p2, nume: "k294 — Kaufland 8970 Bragadiru — condiționare chimică + purjare", clientId: c1, categorie: "Kaufland", stadiu: "Contract", procentExecutie: 20,
        valoareOferta: 29848.13, valoareContract: 29848.13, costRealizat: 5000, dataStart: "", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0, devize: [] },
      { id: p3, nume: "k301 — Kaufland 7910 Pipera", clientId: c1, categorie: "Kaufland", stadiu: "Finalizat", procentExecutie: 100,
        valoareOferta: 1507.51, valoareContract: 1507.51, costRealizat: 1100, dataStart: "2026-06-05", dataFinal: "2026-06-05",
        materialeAchizitionate: 0, materialePuseInOpera: 0, devize: [] },
      { id: p4, nume: "374 — Atalian — Sky Tower", clientId: c2, categorie: "Alte companii", stadiu: "Execuție", procentExecutie: 55,
        valoareOferta: 2249.53, valoareContract: 2249.53, costRealizat: 1200, dataStart: "", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0,
        devize: [
          { id: uid(), moment: "Inițial (ofertă)", data: "2026-03-01", linii: [
            { id: uid(), categorie: "Materiale consumabile", denumire: "Garnitură clingherit plată pt. racord flexibil 1/2 18,5x11x2mm", cod: "", furnizor: "", um: "buc", cantitate: 100, pretUnitar: 0.78 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Racord inox ext. D15 1/2Mx1/2F 250-520mm", cod: "", furnizor: "", um: "buc", cantitate: 18, pretUnitar: 50.04 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Racord olandez, alamă nichelată, pentru calorifer, Hidra, FE-FI, D.1/2\"", cod: "", furnizor: "Hidra", um: "buc", cantitate: 18, pretUnitar: 16.9 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Cot, alamă nichelată, Hidra, FE-FI, D.1/2''", cod: "", furnizor: "Hidra", um: "buc", cantitate: 12, pretUnitar: 13.34 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Niplu, alamă cromată, Hidra, FE-FE, D.1/2\"", cod: "", furnizor: "Hidra", um: "buc", cantitate: 6, pretUnitar: 6.11 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Robinet alamă nichelată, cu fluture, Giacomini R250, FI-FI, D.1/2\"", cod: "", furnizor: "Giacomini", um: "buc", cantitate: 18, pretUnitar: 35.83 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Sfoară etanșare filete Loctite 55, 160M", cod: "", furnizor: "Loctite", um: "buc", cantitate: 1, pretUnitar: 59.62 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Racord PPR, gri, Firat, D.20mm x1/2\"FI", cod: "", furnizor: "Firat", um: "buc", cantitate: 4, pretUnitar: 4.14 },
            { id: uid(), categorie: "Materiale consumabile", denumire: "Țeavă PPR, gri, cu fibră compozită, Firat, P.20bar, L=4m, D.20mm", cod: "", furnizor: "Firat", um: "buc", cantitate: 1, pretUnitar: 17.39 },
            { id: uid(), categorie: "Manoperă", denumire: "Manoperă montaj instalație sanitară Sky Tower", cod: "", furnizor: "", um: "ore", cantitate: 12, pretUnitar: 90 },
          ]},
        ],
        activitatiGantt: [
          { id: uid(), denumire: "Aprovizionare materiale", dataStart: "2026-03-02", dataFinal: "2026-03-06", procent: 100, angajatId: e3 },
          { id: uid(), denumire: "Montaj instalație sanitară", dataStart: "2026-03-09", dataFinal: "2026-07-31", procent: 60, angajatId: e3 },
          { id: uid(), denumire: "Probe presiune și recepție", dataStart: "2026-08-03", dataFinal: "2026-08-05", procent: 0, angajatId: e1 },
        ] },
      { id: p5, nume: "nvt429 — Amis / Elena Hala", clientId: c3, categorie: "Clienți privați", stadiu: "Execuție", procentExecutie: 60,
        valoareOferta: 200000, valoareContract: 200000, costRealizat: 130000, dataStart: "2026-03-09", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0, devize: [],
        activitatiGantt: [
          { id: uid(), denumire: "Montaj instalație electrică hală", dataStart: "2026-07-27", dataFinal: "2026-08-07", procent: 50, angajatId: e2 },
          { id: uid(), denumire: "Montaj instalație electrică hală", dataStart: "2026-07-27", dataFinal: "2026-08-07", procent: 50, angajatId: e6 },
        ] },
      { id: p6, nume: "293 — Răzvan Zamfiroiu — montaj PDC", clientId: c4, categorie: "Clienți privați", stadiu: "Execuție", procentExecutie: 80,
        valoareOferta: 125666.77, valoareContract: 125666.77, costRealizat: 98000, dataStart: "2024-12-04", dataFinal: "",
        materialeAchizitionate: 0, materialePuseInOpera: 0, devize: [] },
    ],
    // Echipa reală Novatech (din foaia "Salarii"/"Pontaj")
    angajati: [
      { id: e1, nume: "Cosmin Burtoi", rol: "Director / Administrator", zileConcediuAnual: 21, zileConcediuFolosite: 4, costOra: 130, activ: true, dataIncetare: "",
        certificari: [{ id: uid(), nume: "Responsabil tehnic cu execuția (RTE)", dataExpirare: "2026-10-15" }], medicinaMuncii: { dataExpirare: "2026-09-10" } },
      { id: e2, nume: "Albu Filip Anel", rol: "Tehnician instalații", zileConcediuAnual: 21, zileConcediuFolosite: 6, costOra: 81.16, activ: true, dataIncetare: "",
        certificari: [], medicinaMuncii: { dataExpirare: "2026-09-01" } },
      { id: e3, nume: "Crețan Andrei Mădălin", rol: "Șef echipă", zileConcediuAnual: 21, zileConcediuFolosite: 6, costOra: 93.66, activ: true, dataIncetare: "",
        certificari: [{ id: uid(), nume: "Autorizație ANRE electrician", dataExpirare: "2026-08-20" }], medicinaMuncii: { dataExpirare: "2026-08-25" } },
      { id: e4, nume: "Dudau Laurentiu", rol: "Tehnician instalații", zileConcediuAnual: 21, zileConcediuFolosite: 17, costOra: 230.99, activ: false, dataIncetare: "2026-07-01",
        certificari: [], medicinaMuncii: { dataExpirare: "2027-01-15" } },
      { id: e5, nume: "Dulgheru Liviu", rol: "Tehnician instalații", zileConcediuAnual: 21, zileConcediuFolosite: 3, costOra: 85, activ: true, dataIncetare: "",
        certificari: [], medicinaMuncii: { dataExpirare: "2027-02-01" } },
      { id: e6, nume: "Păuna Adrian", rol: "Tehnician instalații", zileConcediuAnual: 21, zileConcediuFolosite: 3, costOra: 85, activ: true, dataIncetare: "",
        certificari: [], medicinaMuncii: { dataExpirare: "2026-12-01" } },
    ],
    concedii: [
      { id: uid(), angajatId: e3, tip: "Odihnă", dataStart: "2026-08-10", dataFinal: "2026-08-14", nrZile: 5, status: "Cerere" },
      { id: uid(), angajatId: e4, tip: "Odihnă", dataStart: "2026-06-01", dataFinal: "2026-06-05", nrZile: 5, status: "Avizat" },
      { id: uid(), angajatId: e2, tip: "Medical", nrCertificatMedical: "CM0234567", dataStart: "2026-07-14", dataFinal: "2026-07-18", nrZile: 5, status: "Avizat" },
    ],
    pontaje: [
      { id: uid(), angajatId: e3, proiectId: p4, data: "2026-07-14", ore: 8 },
      { id: uid(), angajatId: e3, proiectId: p4, data: "2026-07-15", ore: 8 },
      { id: uid(), angajatId: e1, proiectId: p4, data: "2026-07-14", ore: 4 },
    ],
    salarii: [
      { id: uid(), angajatId: e2, luna: "2026-07", zileLucratoare: 18, co: 3, cm: 0, alteInvoiri: 0, zileLucrateExtra: 0, zileLucrate: 15, zilePrestate: 12,
        brutInCM: 8739.75, net: 5000, cash: 325, bonuriMasa: 700, cas: 2137, cass: 855, impozitVenit: 556, cam: 192.33, brut: 8739.75, cost: 9739.75 },
      { id: uid(), angajatId: e3, luna: "2026-07", zileLucratoare: 18, co: 3, cm: 0, alteInvoiri: 0, zileLucrateExtra: 0, zileLucrate: 15, zilePrestate: 13,
        brutInCM: 11239.75, net: 6100, cash: 400, bonuriMasa: 700, cas: 2750, cass: 1100, impozitVenit: 720, cam: 247, brut: 11239.75, cost: 11239.75 },
      { id: uid(), angajatId: e4, luna: "2026-07", zileLucratoare: 18, co: 3, cm: 10, alteInvoiri: 0, zileLucrateExtra: 0, zileLucrate: 5, zilePrestate: 0,
        brutInCM: 9239.75, net: 5300, cash: 200, bonuriMasa: 300, cas: 2260, cass: 904, impozitVenit: 590, cam: 203, brut: 9239.75, cost: 9239.75 },
    ],
    garantii: [],
    tichete: [
      { id: uid(), clientId: c1, descriere: "Verificare stație condiționare chimică — Kaufland Pantelimon", status: "Deschis", dataCreare: "2026-07-20" },
    ],
    facturi: [
      { id: uid(), tip: "emisa", proiectId: p3, partener: "Kaufland România", valoareFaraTva: 1267.02, cotaTva: 19, data: "2026-06-05", status: "Încasată" },
      { id: uid(), tip: "emisa", proiectId: p4, partener: "Atalian Sky", valoareFaraTva: 1890.36, cotaTva: 19, data: "2026-07-08", status: "Emisă" },
      { id: uid(), tip: "primita", proiectId: p4, partener: "Furnizor materiale sanitare (demo)", valoareFaraTva: 4200, cotaTva: 19, data: "2026-07-10", status: "Neînregistrată" },
    ],
    // Parc auto real (numere de înmatriculare din "2. Cash_Flow2026.xlsx") — marca e o
    // presupunere rezonabilă (nu era în fișier) și trebuie actualizată cu cea reală.
    active: [
      { id: uid(), tip: "vehicul", marca: "Ford Transit", numarInmatriculare: "B 110 NVT", denumire: "Ford Transit — B 110 NVT", responsabil: "Crețan Andrei Mădălin", valoare: 0,
        itpExpira: "2026-08-15", rcaExpira: "2027-01-10", revizieExpira: "2026-09-01", costLunarMediu: 1200, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
      { id: uid(), tip: "vehicul", marca: "Volkswagen Transporter", numarInmatriculare: "B 02 NVT", denumire: "Volkswagen Transporter — B 02 NVT", responsabil: "Albu Filip Anel", valoare: 0,
        itpExpira: "2026-09-20", rcaExpira: "2026-12-01", revizieExpira: "2026-10-15", costLunarMediu: 1100, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
      { id: uid(), tip: "vehicul", marca: "Dacia Dokker", numarInmatriculare: "B 105 NVT", denumire: "Dacia Dokker — B 105 NVT", responsabil: "Dudau Laurentiu", valoare: 0,
        itpExpira: "2027-02-15", rcaExpira: "2026-08-12", revizieExpira: "2026-12-01", costLunarMediu: 1150, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
      { id: uid(), tip: "vehicul", marca: "Ford Transit Custom", numarInmatriculare: "B 31 NVT", denumire: "Ford Transit Custom — B 31 NVT", responsabil: "Dulgheru Liviu", valoare: 0,
        itpExpira: "2026-11-01", rcaExpira: "2027-03-01", revizieExpira: "2026-10-01", costLunarMediu: 1050, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
      { id: uid(), tip: "vehicul", marca: "Volkswagen Caddy", numarInmatriculare: "NT 06 NLW", denumire: "Volkswagen Caddy — NT 06 NLW", responsabil: "Păuna Adrian", valoare: 0,
        itpExpira: "2026-08-05", rcaExpira: "2026-08-12", revizieExpira: "2026-09-10", costLunarMediu: 1300, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
      { id: uid(), tip: "vehicul", marca: "Dacia Duster", numarInmatriculare: "B115NVT", denumire: "Dacia Duster — B115NVT", responsabil: "Cosmin Burtoi", valoare: 0,
        itpExpira: "2027-01-20", rcaExpira: "2026-12-20", revizieExpira: "2026-11-01", costLunarMediu: 1200, gpsMontat: false, gpsFurnizor: "", cheltuieliAuto: [] },
    ],
    materialeStoc: [
      { id: uid(), denumire: "Țeavă cupru 22mm", cantitate: 340, um: "m", valoareUnitara: 32 },
      { id: uid(), denumire: "Unitate exterioară VRF (rezervă)", cantitate: 1, um: "buc", valoareUnitara: 22000 },
    ],
    achizitiiPlanificate: [
      { id: uid(), denumire: "Echipamente montaj — comandă în curs", valoareEstimata: 15000, cotaTva: 19, dataEstimata: "2026-07-30" },
    ],
    cashflow: [
      { id: uid(), saptamana: "1 | 29 DEC - 4 IAN", an: 2026, soldInceput: 0,
        venituri: { echipamente: 0, produseMateriale: 220.83, servicii: 0, alteSurse: 0 },
        cheltuieli: { chirii: 3500, utilitati: 600, asigurari: 200, administrative: 300, marketing: 0, contabilitate: 500, telefonieInternet: 250, salarii: 0, taxe: 0, bonuriMasa: 0, abonamenteSoftware: 150, medicinaMuncii: 0, ssm: 0, onrc: 0, mentenantaReparatii: 0, dobanziTaxeBancare: 50, calatoriiAfaceri: 0 } },
      { id: uid(), saptamana: "2 | 5-11 IAN", an: 2026, soldInceput: -12006.67,
        venituri: { echipamente: 0, produseMateriale: 0, servicii: 0, alteSurse: 0 },
        cheltuieli: { chirii: 0, utilitati: 0, asigurari: 0, administrative: 200, marketing: 0, contabilitate: 0, telefonieInternet: 0, salarii: 45000, taxe: 0, bonuriMasa: 0, abonamenteSoftware: 0, medicinaMuncii: 0, ssm: 0, onrc: 0, mentenantaReparatii: 0, dobanziTaxeBancare: 0, calatoriiAfaceri: 0 } },
      { id: uid(), saptamana: "3 | 12-18 IAN", an: 2026, soldInceput: 46853.18,
        venituri: { echipamente: 121000, produseMateriale: 0, servicii: 0, alteSurse: 0 },
        cheltuieli: { chirii: 0, utilitati: 0, asigurari: 0, administrative: 300, marketing: 0, contabilitate: 0, telefonieInternet: 0, salarii: 0, taxe: 0, bonuriMasa: 0, abonamenteSoftware: 0, medicinaMuncii: 0, ssm: 0, onrc: 0, mentenantaReparatii: 0, dobanziTaxeBancare: 0, calatoriiAfaceri: 0 } },
      { id: uid(), saptamana: "4 | 19-25 IAN", an: 2026, soldInceput: 122311.89,
        venituri: { echipamente: 0, produseMateriale: 0, servicii: 0, alteSurse: 0 },
        cheltuieli: { chirii: 0, utilitati: 0, asigurari: 0, administrative: 200, marketing: 0, contabilitate: 0, telefonieInternet: 0, salarii: 0, taxe: 0, bonuriMasa: 0, abonamenteSoftware: 0, medicinaMuncii: 0, ssm: 0, onrc: 0, mentenantaReparatii: 0, dobanziTaxeBancare: 0, calatoriiAfaceri: 0 } },
    ],
  };
}

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
const ISTORIC_FINANCIAR = [
  { an: 2022, cifraAfaceri: 983654.67, totalVenituri: 983655.19, totalCheltuieli: 767017.52, profitNet: 216637.67,
    capitaluriProprii: 422087.00, activeImobilizateNete: 76818.45, creante: 83501.49, trezorerie: 316682.98,
    datoriiTermenLung: 0, datoriiCurente: 76190.96 },
  { an: 2023, cifraAfaceri: 2195183.11, totalVenituri: 2195187.82, totalCheltuieli: 1885017.72, profitNet: 310170.10,
    capitaluriProprii: 424154.82, activeImobilizateNete: 106491.70, creante: 365980.98, trezorerie: 276525.80,
    datoriiTermenLung: 142500.00, datoriiCurente: 187002.49 },
  { an: 2024, cifraAfaceri: 1948382.79, totalVenituri: 1948388.41, totalCheltuieli: 2252778.73, profitNet: -304390.32,
    capitaluriProprii: -298259.47, activeImobilizateNete: 63413.93, creante: 407221.67, trezorerie: -102348.29,
    datoriiTermenLung: 325166.66, datoriiCurente: 243592.94 },
];
function ultimulAnFinanciar() { return ISTORIC_FINANCIAR[ISTORIC_FINANCIAR.length - 1]; }

/* ---------------------------- Context date ---------------------------- */

const DataCtx = createContext(null);
const useData = () => useContext(DataCtx);

/* ---------------------------- Hook stocare persistentă ---------------------------- */

function usePersistentData() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | saving | error
  const skipNextSave = useRef(true);
  const saveTimer = useRef(null);
  const lastWritten = useRef(null); // evită ecoul propriei scrieri prin realtime

  const ROW_ID = 1;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (supabaseConfigured) {
          let { data: row, error } = await supabase.from("app_state").select("data").eq("id", ROW_ID).single();
          if (cancelled) return;
          if (error && error.code === "PGRST116") {
            // rândul nu există încă — îl creăm cu datele demo inițiale
            const seed = seedData();
            await supabase.from("app_state").insert({ id: ROW_ID, data: seed });
            row = { data: seed };
          } else if (error) {
            throw error;
          }
          const json = JSON.stringify(row.data);
          lastWritten.current = json;
          setData(row.data);
        } else {
          const res = await window.storage.get(STORAGE_KEY, true);
          if (cancelled) return;
          if (res && res.value) setData(JSON.parse(res.value));
          else setData(seedData());
        }
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setData(seedData());
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // sincronizare live: când alt dispozitiv salvează, primim update-ul automat
  useEffect(() => {
    if (!supabaseConfigured) return;
    const channel = supabase
      .channel("app_state_changes")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state", filter: `id=eq.${ROW_ID}` }, (payload) => {
        const json = JSON.stringify(payload.new.data);
        if (json === lastWritten.current) return; // e propria noastră scriere, ignorăm
        skipNextSave.current = true;
        lastWritten.current = json;
        setData(payload.new.data);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (data === null) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (supabaseConfigured) {
          const json = JSON.stringify(data);
          lastWritten.current = json;
          const { error } = await supabase.from("app_state").update({ data, updated_at: new Date().toISOString() }).eq("id", ROW_ID);
          if (error) throw error;
        } else {
          await window.storage.set(STORAGE_KEY, JSON.stringify(data), true);
        }
        setStatus("ready");
      } catch (e) {
        setStatus("error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  const update = useCallback((fn) => setData((prev) => fn(structuredClone(prev))), []);
  const reset = useCallback(async () => {
    const fresh = seedData();
    setData(fresh);
    try {
      if (supabaseConfigured) {
        lastWritten.current = JSON.stringify(fresh);
        await supabase.from("app_state").update({ data: fresh, updated_at: new Date().toISOString() }).eq("id", ROW_ID);
      } else {
        await window.storage.set(STORAGE_KEY, JSON.stringify(fresh), true);
      }
    } catch (e) {}
  }, []);

  return { data, status, update, reset };
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
const CATEGORII_PROIECT = ["Kaufland", "Clienți privați", "Alte companii"];

function emptyProiect() {
  return { id: null, nume: "", clientId: "", categorie: "", stadiu: "Ofertare", procentExecutie: 0, valoareOferta: "", valoareContract: "",
    costRealizat: "", dataStart: "", dataFinal: "", materialeAchizitionate: "", materialePuseInOpera: "", devize: [] };
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
  const proiecteFiltrate = filtruCategorie ? data.proiecte.filter((p) => (p.categorie || "Alte companii") === filtruCategorie) : data.proiecte;

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Ofertare → contract → execuție → contabilizarea costurilor, per proiect.</p>
        <div className="btn-row">
          <select value={filtruCategorie} onChange={(e) => setFiltruCategorie(e.target.value)}>
            <option value="">Toate categoriile</option>
            {CATEGORII_PROIECT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button onClick={() => setModal(emptyProiect())}><IconPlus size={15} /> Proiect nou</Button>
        </div>
      </div>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Proiect</th><th>Client</th><th>Categorie</th><th>Stadiu</th><th>Execuție</th>
              <th className="num">Valoare contract</th><th className="num">Cost realizat</th>
              <th className="num">Marjă</th><th></th>
            </tr>
          </thead>
          <tbody>
            {proiecteFiltrate.map((p) => {
              const val = p.valoareContract ?? p.valoareOferta ?? 0;
              const marja = val - (p.costRealizat || 0);
              const nrDevize = (p.devize || []).length;
              const categorie = p.categorie || "Alte companii";
              return (
                <tr key={p.id}>
                  <td>
                    <div className="cell-title">{p.nume}</div>
                    <div className="cell-sub mono">{fmtDate(p.dataStart)} → {fmtDate(p.dataFinal)}</div>
                  </td>
                  <td>{clientName(p.clientId)}</td>
                  <td><Badge tone={categorie === "Kaufland" ? "accent" : categorie === "Clienți privați" ? "warn" : "neutral"}>{categorie}</Badge></td>
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
            {proiecteFiltrate.length === 0 && <tr><td colSpan={9}><EmptyState text="Niciun proiect încă." /></td></tr>}
          </tbody>
        </table>
      </Card>

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

function DevizForm({ initial, onSave, onCancel }) {
  const [moment, setMoment] = useState(initial.moment || "Inițial (ofertă)");
  const [data, setDataVal] = useState(initial.data || "");
  const [linii, setLinii] = useState(initial.linii && initial.linii.length ? initial.linii : []);

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
      <Button type="button" variant="ghost" size="sm" onClick={addLinie}><IconPlus size={14} /> Adaugă linie</Button>

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
  const [f, setF] = useState(proiect);
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

function PontajForm({ angajati, proiecte, onSave, onCancel }) {
  const [f, setF] = useState(emptyPontaj());
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

  return (
    <div className="stack-lg">
      <div className="section-toolbar">
        <p className="section-intro">Bază de clienți, garanții acordate și solicitări de service.</p>
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
                <td className="cell-title">{c.nume}</td>
                <td>{c.contact}</td>
                <td className="actions">
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
    </div>
  );
}

const TIPURI_DOCUMENT_CLIENT = ["Contract", "Act adițional", "Garanție", "Alt document"];

function DocumenteClientList({ documente, onAdaugaDocument, onSterge }) {
  return (
    <div className="stack-md">
      <div className="section-toolbar">
        <p className="section-intro">Contracte, acte adiționale, garanții și alte documente asociate acestui client.</p>
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

function emptyFactura() {
  return { id: null, tip: "emisa", proiectId: "", partener: "", valoareFaraTva: "", cotaTva: 19, data: "", status: "Emisă" };
}

function ModuleFinanciar() {
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
      <Field label="Partener (client/furnizor)"><input required value={f.partener} onChange={set("partener")} /></Field>
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
  const [numeProiect, setNumeProiect] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientNou, setClientNou] = useState("");
  const [categorie, setCategorie] = useState(CATEGORII_PROIECT[0]);

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
        <Button variant="ghost" size="sm" onClick={addLinie} style={{ marginTop: 10 }}><IconPlus size={14} /> Adaugă linie</Button>
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
  { key: "personal", label: "Personal", Icon: IconUsers, View: ModulePersonal },
  { key: "clienti", label: "Clienți", Icon: IconClients, View: ModuleClienti },
  { key: "financiar", label: "Financiar", Icon: IconMoney, View: ModuleFinanciar },
  { key: "patrimoniu", label: "Patrimoniu", Icon: IconTruck, View: ModulePatrimoniu },
  { key: "cashflow", label: "Cash-Flow", Icon: IconCashflow, View: ModuleCashflow },
  { key: "calculator", label: "Calculator", Icon: IconCalc, View: ModuleCalculator },
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

function Shell({ onSignOut, userEmail }) {
  const [tab, setTab] = useState("dashboard");
  const { status, reset } = useData();
  const active = NAV.find((n) => n.key === tab);
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
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${tab === n.key ? "active" : ""}`} onClick={() => selecteazaTab(n.key)}>
              <n.Icon size={17} /> <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {userEmail && <div className="sidebar-user">{userEmail}</div>}
          {onSignOut && <button className="link-btn muted" onClick={onSignOut}>Deconectare</button>}
          {!resetConfirm ? (
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
      {!aiOpen && (
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
  const { session, authError, signIn, signOut } = useAuth();
  const store = usePersistentData();

  if (supabaseConfigured && session === undefined) {
    return (
      <div className="novatech-root">
        <style>{STYLES}</style>
        <div className="loading-screen">Se verifică autentificarea…</div>
      </div>
    );
  }

  if (supabaseConfigured && session === null) {
    return (
      <div className="novatech-root">
        <style>{STYLES}</style>
        <LoginScreen onSignIn={signIn} error={authError} />
      </div>
    );
  }

  if (store.data === null) {
    return (
      <div className="novatech-root">
        <style>{STYLES}</style>
        <div className="loading-screen">Se încarcă datele Novatech…</div>
      </div>
    );
  }

  return (
    <div className="novatech-root">
      <style>{STYLES}</style>
      <DataCtx.Provider value={store}>
        <ToastProvider>
          <Shell onSignOut={supabaseConfigured ? signOut : null} userEmail={session?.user?.email} />
        </ToastProvider>
      </DataCtx.Provider>
    </div>
  );
}
