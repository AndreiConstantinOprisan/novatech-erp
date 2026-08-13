import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: dacă găzduiești pe GitHub Pages la
// https://<user>.github.io/<repo>/  →  base trebuie să fie "/<repo>/"
// dacă folosești un domeniu propriu sau <user>.github.io direct → base: "/"
export default defineConfig({
  plugins: [react()],
  base: "/novatech-erp/",
});
