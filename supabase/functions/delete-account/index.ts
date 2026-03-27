import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        error:
          "Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Best-effort cleanup: profile row + avatar files, then delete auth user.
  // If any cleanup step fails, we still try to delete the auth user.
  let cleanupWarnings: string[] = [];

  try {
    const { error: deleteProfileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (deleteProfileError) cleanupWarnings.push(deleteProfileError.message);
  } catch (e) {
    cleanupWarnings.push(String(e));
  }

  try {
    // Remove any avatar files under `${userId}/...`
    const filesToRemove: string[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data: objects, error: listError } = await adminClient.storage
        .from("avatars")
        .list(userId, { limit, offset });
      if (listError) {
        cleanupWarnings.push(listError.message);
        break;
      }
      if (!objects || objects.length === 0) break;

      for (const obj of objects) {
        filesToRemove.push(`${userId}/${obj.name}`);
      }

      if (objects.length < limit) break;
      offset += limit;
    }

    if (filesToRemove.length) {
      const { error: removeError } = await adminClient.storage
        .from("avatars")
        .remove(filesToRemove);
      if (removeError) cleanupWarnings.push(removeError.message);
    }
  } catch (e) {
    cleanupWarnings.push(String(e));
  }

  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(
    userId,
  );

  if (deleteUserError) {
    return new Response(JSON.stringify({ error: deleteUserError.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, warnings: cleanupWarnings }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

