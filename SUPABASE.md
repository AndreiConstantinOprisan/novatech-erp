# Configurare Supabase (bază de date reală + login)

## 1. Creează cont și proiect

1. Mergi pe https://supabase.com și apasă „Start your project"
2. Autentifică-te (cel mai simplu: cu contul de GitHub, cel deja creat)
3. Apasă „New project"
4. Alege un nume (ex: `novatech-erp`), o parolă pentru baza de date (o poți
   genera automat — salveaz-o undeva sigur, deși n-o vei folosi des), și
   regiunea cea mai apropiată (ex: Frankfurt/EU)
5. Apasă „Create new project" — durează ~2 minute să se pregătească

## 2. Rulează schema bazei de date

1. În proiectul nou, mergi în meniul din stânga la „SQL Editor"
2. Apasă „New query"
3. Deschide fișierul `supabase_schema.sql` din acest folder, copiază tot
   conținutul, lipește-l în editor
4. Apasă „Run" (sau Ctrl+Enter)
5. Ar trebui să vezi „Success. No rows returned"

## 3. Ia adresa (URL) și cheia publică (anon key)

1. Mergi la „Settings" (roata dințată, jos în stânga) → „API"
2. Copiază valoarea de la **„Project URL"** (arată ca
   `https://xxxxxxxxxxxx.supabase.co`)
3. Copiază valoarea de la **„anon public"** din secțiunea „Project API keys"
   (un text lung)

## 4. Completează-le în cod

1. Deschide fișierul `src/supabaseClient.js`
2. Înlocuiește `__SUPABASE_URL__` cu URL-ul copiat mai sus
3. Înlocuiește `__SUPABASE_ANON_KEY__` cu cheia anon copiată mai sus
4. Salvează fișierul

## 5. Creează primul cont de utilizator (login)

1. În Supabase, mergi la „Authentication" → „Users"
2. Apasă „Add user" → „Create new user"
3. Introdu emailul și o parolă pentru tine
4. Bifează „Auto Confirm User" (ca să poți intra imediat, fără email de
   confirmare)
5. Apasă „Create user"
6. Pentru a adăuga mai târziu și alți angajați, repeți acești pași oricând

## 6. Publică modificările

Încarcă fișierul `src/supabaseClient.js` modificat înapoi în repository-ul de
GitHub (îl suprascrii pe cel vechi — deschide-l în GitHub, apasă iconița de
creion „Edit", lipește noul conținut, Commit changes). GitHub Actions va
reconstrui și republica automat aplicația în ~1 minut.

## 7. Intră din nou pe aplicație

Deschide din nou linkul aplicației (sau reinstalează pe telefon dacă e cazul)
— acum ar trebui să vezi un ecran de login. Intră cu emailul și parola create
la pasul 5.

De acum, orice modificare făcută pe un dispozitiv apare automat și pe
celelalte, în câteva secunde.
