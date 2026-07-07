// ═══════════════════════════════════════════════════════════════
// Edge Function: admin-users
// Gerencia usuários (criar / editar / trocar senha / excluir) usando
// a service_role key do Supabase — que NUNCA fica exposta no app.
// Só quem for "master" (checado via tabela de perfis) pode chamar,
// exceto na criação do primeiro usuário (bootstrap).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const EMAIL_DOMAIN = '@caieiraspatrimonio.local'
const PERFIS_TABLE = 'CaieirasPatrimonio_perfis'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const action = body.action

  try {
    // Bootstrap: se ainda não existe NENHUM perfil, permite criar o
    // primeiro usuário (que será master) sem exigir autenticação prévia.
    const { count } = await admin
      .from(PERFIS_TABLE)
      .select('*', { count: 'exact', head: true })
    const isBootstrap = action === 'create' && (count ?? 0) === 0

    let callerIsMaster = false
    if (!isBootstrap) {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return json({ error: 'Não autenticado.' }, 401)

      const { data: userData, error: userErr } = await admin.auth.getUser(token)
      if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401)

      const { data: callerProfile } = await admin
        .from(PERFIS_TABLE)
        .select('is_master')
        .eq('id', userData.user.id)
        .maybeSingle()

      callerIsMaster = !!callerProfile?.is_master
      if (!callerIsMaster) {
        return json({ error: 'Apenas usuários master podem gerenciar usuários.' }, 403)
      }
    }

    // ── Criar usuário ──
    if (action === 'create') {
      const login = (body.login || '').toLowerCase().trim()
      const senha = body.senha || ''
      const nome = (body.nome || '').trim()
      const church = body.church || ''

      if (!login) return json({ error: 'Informe o usuário.' }, 400)
      if (!senha || senha.length < 4) return json({ error: 'Senha mínima de 4 caracteres.' }, 400)

      const { data: existing } = await admin
        .from(PERFIS_TABLE).select('id').eq('login', login).maybeSingle()
      if (existing) return json({ error: 'Usuário já existe.' }, 400)

      const email = login + EMAIL_DOMAIN
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true
      })
      if (createErr) return json({ error: createErr.message }, 400)

      const { error: profErr } = await admin.from(PERFIS_TABLE).insert({
        id: created.user.id,
        login,
        nome: nome || login,
        church: isBootstrap ? '' : church,
        is_master: isBootstrap ? true : !church
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profErr.message }, 400)
      }
      return json({ ok: true, bootstrap: isBootstrap })
    }

    // ── Editar usuário (login/nome/igreja) ──
    if (action === 'update') {
      const targetId = body.targetId
      if (!targetId) return json({ error: 'targetId obrigatório.' }, 400)

      const login = body.login ? String(body.login).toLowerCase().trim() : undefined
      const nome = body.nome
      const church = body.church

      if (login) {
        const { data: dup } = await admin
          .from(PERFIS_TABLE).select('id').eq('login', login).neq('id', targetId).maybeSingle()
        if (dup) return json({ error: 'Esse login já está em uso.' }, 400)

        const { error: authErr } = await admin.auth.admin.updateUserById(targetId, { email: login + EMAIL_DOMAIN })
        if (authErr) return json({ error: authErr.message }, 400)
      }

      const updatePayload = {}
      if (login) updatePayload.login = login
      if (nome !== undefined) updatePayload.nome = nome
      if (church !== undefined) updatePayload.church = church
      updatePayload.is_master = !church

      const { error: profErr } = await admin.from(PERFIS_TABLE).update(updatePayload).eq('id', targetId)
      if (profErr) return json({ error: profErr.message }, 400)
      return json({ ok: true })
    }

    // ── Trocar senha de outro usuário ──
    if (action === 'updatePassword') {
      const targetId = body.targetId
      const senha = body.senha || ''
      if (!targetId) return json({ error: 'targetId obrigatório.' }, 400)
      if (!senha || senha.length < 4) return json({ error: 'Senha mínima de 4 caracteres.' }, 400)

      const { error } = await admin.auth.admin.updateUserById(targetId, { password: senha })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ── Excluir usuário ──
    if (action === 'delete') {
      const targetId = body.targetId
      if (!targetId) return json({ error: 'targetId obrigatório.' }, 400)

      const { error } = await admin.auth.admin.deleteUser(targetId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
