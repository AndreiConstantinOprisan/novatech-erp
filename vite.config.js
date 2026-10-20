import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cu domeniu propriu (erp.novatechproiect.ro), aplicația stă la rădăcina
// subdomeniului, deci base rămâne "/". (Dacă te întorci vreodată la adresa
// gratuită github.io/novatech-erp/, schimbă înapoi în "/novatech-erp/".)
export default defineConfig({
  plugins: [react()],
  base: "/",
});
