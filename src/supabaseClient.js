import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://zjkzapcmlyumdgvgpras.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_uaU1ckTx3eYhereqDfP14g_N2jayIRP";

export const supabaseConfigured =
  SUPABASE_URL !== "__SUPABASE_URL__" && SUPABASE_ANON_KEY !== "__SUPABASE_ANON_KEY__";

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
