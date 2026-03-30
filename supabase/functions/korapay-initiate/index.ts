import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { nairaToKobo } from "../_shared/korapay.ts";

type Purpose = "activation" | "subscription";

function getPurpose(value: unknown): Purpose | null {
  if (value === "activation") return "activation";
  if (value === "subscription") return "subscription";
  return null;
}

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const purpose = getPurpose((body as { purpose?: unknown }).purpose);
  if (!purpose) {
    return new Response(JSON.stringify({ error: "Invalid purpose" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const activationFeeNgn = Number(Deno.env.get("ACTIVATION_FEE_NGN") ?? "300");
  const subscriptionFeeNgn = Number(Deno.env.get("SUBSCRIPTION_FEE_NGN") ?? "300");

  const amountNgn = purpose === "activation" ? activationFeeNgn : subscriptionFeeNgn;
  const amountKobo = nairaToKobo(amountNgn);
  const currency = "NGN";

  const merchantReference = `SC-${purpose.toUpperCase()}-${crypto.randomUUID()}`;
  const notificationUrl = `${supabaseUrl}/functions/v1/korapay-webhook`;

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { error: insertError } = await admin.from("billing_payments").insert({
    user_id: user.id,
    purpose,
    amount_kobo: amountKobo,
    currency,
    merchant_reference: merchantReference,
    status: "pending",
  });

  if (insertError) {
    return new Response(JSON.stringify({ error: "Failed to create payment" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      reference: merchantReference,
      amount: amountKobo,
      currency,
      notification_url: notificationUrl,
      amount_ngn: amountNgn,
      purpose,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

