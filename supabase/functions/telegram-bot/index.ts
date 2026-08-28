/**
 * Telegram Bot proxy for iCalc (admin / system use).
 *
 * Secrets (never commit tokens):
 * supabase secrets set TELEGRAM_BOT_TOKEN=…
 * supabase secrets set TELEGRAM_CHAT_ID=… (optional default storage chat)
 *
 * Deploy:
 * supabase functions deploy telegram-bot
 *
 * Admin portal / dev-skip do NOT require pasting a bot token in the UI.
 * End-user Premium/Regular accounts still link their own bot on first login after approval.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN secret not set' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as { method?: string; payload?: Record<string, unknown> };
    const method = (body.method || 'getMe').replace(/[^\w]/g, '');
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload ?? {}),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.ok ? 200 : 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'proxy failed' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
