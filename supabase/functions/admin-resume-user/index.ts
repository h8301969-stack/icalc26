import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { admin_token, code } = await req.json();
    if (!admin_token || !code) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing parameters.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: resumeResult, error: resumeError } = await admin.rpc('admin_resume_code', {
      p_token: admin_token,
      p_code: String(code).trim().toUpperCase(),
    });

    if (resumeError || !resumeResult?.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: resumeResult?.error ?? resumeError?.message ?? 'Resume failed.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = resumeResult.user_id as string | null;
    const accessCode = resumeResult.code as string;

    if (userId) {
      const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
        password: accessCode,
      });
      if (pwError) {
        return new Response(JSON.stringify({ ok: false, error: pwError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, status: 'approved', code: accessCode }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});