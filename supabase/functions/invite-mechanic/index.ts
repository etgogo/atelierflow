import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_REDIRECT = "https://atelierflow-git-feature-supabase-databas-85e3af-qdqkzdrjvx-5208.vercel.app/?setup-password=1";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Méthode non autorisée." }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return response({ error: "Connexion administrateur requise." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("Missing Supabase function environment variables.");
      return response({ error: "Le service d’invitation n’est pas configuré." }, 500);
    }

    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return response({ error: "Votre session a expiré. Reconnectez-vous." }, 401);

    const body = await req.json();
    const garageId = String(body.garageId || "").trim();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    if (!garageId || !fullName || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return response({ error: "Veuillez fournir un nom, une adresse e-mail valide et un atelier." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: membership, error: membershipError } = await admin
      .from("garage_memberships")
      .select("id")
      .eq("garage_id", garageId)
      .eq("profile_id", authData.user.id)
      .eq("role", "admin")
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return response({ error: "Seul l’administrateur de cet atelier peut créer un compte mécanicien." }, 403);

    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: APP_REDIRECT,
    });
    if (inviteError) {
      const message = /already|registered|exists/i.test(inviteError.message)
        ? "Cette adresse e-mail possède déjà un compte. La fonction de rattachement d’un compte existant sera ajoutée séparément."
        : inviteError.message;
      return response({ error: message }, 400);
    }
    const invitedUser = invitation.user;
    if (!invitedUser?.id) return response({ error: "Le compte a été invité, mais son identifiant n’a pas été retourné." }, 500);

    try {
      const { error: profileError } = await admin.from("profiles").insert({
        id: invitedUser.id,
        full_name: fullName,
      });
      if (profileError) throw profileError;

      const { error: memberError } = await admin.from("garage_memberships").insert({
        garage_id: garageId,
        profile_id: invitedUser.id,
        role: "mechanic",
        is_active: true,
      });
      if (memberError) throw memberError;

      const { error: mechanicError } = await admin.from("mechanic_profiles").insert({
        garage_id: garageId,
        profile_id: invitedUser.id,
      });
      if (mechanicError) throw mechanicError;
    } catch (setupError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(invitedUser.id);
      if (cleanupError) console.error("Failed to clean up partially created invited user:", cleanupError.message);
      throw setupError;
    }

    return response({ success: true, email, fullName });
  } catch (error) {
    console.error("invite-mechanic failed:", error);
    return response({ error: error instanceof Error ? error.message : "Une erreur est survenue pendant la création du compte." }, 500);
  }
});
