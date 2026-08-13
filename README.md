# Novatech ERP — instalare pe telefon (PWA)

Acest folder e o aplicație web completă (React + Vite). Nu se instalează ca fișier —
trebuie găzduită pe internet, apoi „instalată" din Chrome pe telefon.

## Pas 1 — Urcă acest folder pe GitHub

1. Mergi pe https://github.com/new
2. Nume repository: `novatech-erp` (dacă alegi alt nume, schimbă și `base` din
   `vite.config.js` să corespundă: `/numele-tau-repo/`)
3. Lasă-l **Public** (necesar pentru GitHub Pages gratuit)
4. Nu bifa „Add a README" (avem deja unul)
5. Apasă „Create repository"
6. Pe pagina goală care apare, apasă „uploading an existing file"
7. Trage tot conținutul acestui folder (inclusiv folderul ascuns `.github`) și dă
   commit direct pe branch-ul `main`

## Pas 2 — Activează GitHub Pages cu deploy automat

1. În repository, mergi la **Settings → Pages**
2. La „Build and deployment” → „Source”, alege **GitHub Actions**
3. Mergi la tab-ul **Actions** — ar trebui să vezi workflow-ul „Deploy Novatech ERP
   to GitHub Pages” rulând automat (durează ~1 minut)
4. După ce se termină cu bifă verde, adresa aplicației tale e:
   `https://<utilizatorul-tau>.github.io/novatech-erp/`

## Pas 3 — Instalează pe Honor Magic 5 Pro

1. Deschide adresa de mai sus în **Chrome** pe telefon
2. Apasă meniul (⋮) din dreapta sus
3. Alege **„Instalează aplicația”** (sau „Adaugă pe ecranul principal”)
4. Confirmă — apare o iconiță „Novatech” pe ecranul principal, ca orice altă
   aplicație, care se deschide pe tot ecranul, fără bara de adresă

## Notă despre date

Datele aplicației (proiecte, angajați, facturi etc.) se salvează local, direct în
memoria browser-ului de pe telefon (`localStorage`) — nu se sincronizează automat
cu alte dispozitive sau cu Claude. Dacă vrei sincronizare reală între telefon,
laptop etc., următorul pas ar fi un backend (bază de date + API), care e un proiect
separat, mai amplu.

## Dezvoltare locală (opțional, pe calculator)

```bash
npm install
npm run dev       # server local cu reîncărcare automată
npm run build     # generează folderul dist/ (ce se publică pe GitHub Pages)
```
