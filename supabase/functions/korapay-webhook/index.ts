import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { constantTimeEqual, hmacSha256Hex } from "../_shared/korapay.ts";

type KorapayWebhook = {
  event?: string;
  data?: {
    reference?: string;
    payment_reference?: string;
    currency?: string;
    amount?: string | number;
    amount_expected?: string | number;
    status?: string;
    transaction_status?: string;
  };
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const korapaySecretKey = Deno.env.get("KORAPAY_SECRET_KEY");

  if (!supabaseUrl || !supabaseServiceKey || !korapaySecretKey) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signatureHeader = req.headers.get("x-korapay-signature") ?? "";

  let payloadText = "";
  try {
    payloadText = await req.text();
  } catch {
    payloadText = "";
  }

  let payload: KorapayWebhook | null = null;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = null;
  }

  if (!payload?.data) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Korapay signs the webhook with an HMAC-SHA256 hash of JSON.stringify(payload.data),
  // using your Korapay secret key.
  const expectedSignature = await hmacSha256Hex(
    korapaySecretKey,
    JSON.stringify(payload.data),
  );

  if (!signatureHeader || !constantTimeEqual(signatureHeader, expectedSignature)) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const event = payload.event ?? "";
  const merchantReference = payload.data.payment_reference ?? payload.data.reference ?? "";
  const korapayReference = payload.data.reference ?? null;

  if (!merchantReference) {
    return new Response(JSON.stringify({ error: "Missing reference" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: payment, error: paymentError } = await admin
    .from("billing_payments")
    .select("*")
    .eq("merchant_reference", merchantReference)
    .maybeSingle();

  if (paymentError) {
    return new Response(JSON.stringify({ error: "Lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!payment) {
    // Unknown reference: acknowledge so Korapay doesn't retry forever
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (payment.status === "success") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (event !== "charge.success") {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        korapay_reference: korapayReference,
        raw_payload: payload,
      })
      .eq("id", payment.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date();

  const { error: markPaidError } = await admin
    .from("billing_payments")
    .update({
      status: "success",
      paid_at: now.toISOString(),
      korapay_reference: korapayReference,
      raw_payload: payload,
    })
    .eq("id", payment.id);

  if (markPaidError) {
    return new Response(JSON.stringify({ error: "Failed to update payment" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Apply billing effects
  if (payment.purpose === "activation") {
    const paidUntil = addDays(now, 30).toISOString();
    await admin
      .from("profiles")
      .update({
        activation_paid_at: now.toISOString(),
        subscription_paid_until: paidUntil,
        is_public: true,
      })
      .eq("id", payment.user_id);
  } else if (payment.purpose === "subscription") {
    const existing = payment.user_id
      ? await admin
        .from("profiles")
        .select("subscription_paid_until, activation_paid_at")
        .eq("id", payment.user_id)
        .maybeSingle()
      : { data: null, error: null };

    const currentPaidUntil = existing.data?.subscription_paid_until
      ? new Date(existing.data.subscription_paid_until)
      : null;

    const base = currentPaidUntil && currentPaidUntil > now ? currentPaidUntil : now;
    const nextPaidUntil = addDays(base, 30).toISOString();

    await admin
      .from("profiles")
      .update({
        activation_paid_at: existing.data?.activation_paid_at ?? now.toISOString(),
        subscription_paid_until: nextPaidUntil,
        is_public: true,
      })
      .eq("id", payment.user_id);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

