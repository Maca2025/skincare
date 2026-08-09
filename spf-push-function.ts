// ============================================================================
// Edge Function: spf-push
// Un cron la invoca cada 15 min. Decide si toca avisar y manda Web Push a las
// suscripciones que no hayan sido avisadas dentro del ciclo vigente. Las
// suscripciones muertas (404/410) se limpian solas.
//
// QUÉ CAMBIÓ (2026-07-26) — antes: ventana fija 10am-7pm y 2 h fijas.
//   · El plazo ahora sale del UV.
//   · El corte de la tarde ya no son las 19:00 sino el OCASO REAL menos 60 min.
//     A las 18:40 de diciembre en Guadalajara el sol ya se puso y el UV es 0:
//     ese aviso no protegía de nada y solo enseñaba a ignorar los avisos.
//   · El TÍTULO del aviso cambia con la banda de UV. En la pantalla de bloqueo
//     el título es lo único que se lee de un vistazo.
//
// QUÉ CAMBIÓ (2026-08-09) — se cerraron DOS divergencias con `pure.js` que
// llevaban más de una semana vivas y no podía detectar nadie, porque este
// archivo nunca estuvo en el repositorio y la prueba de paridad salía en verde
// sin comparar nada:
//   1. El plazo en UV muy alto y extremo seguía en 1.5 h. La app lo corrigió a
//      2 h el 2026-08-01 —el 1.5 era un supuesto nuestro, no una indicación
//      clínica—, así que el celular avisaba antes que la app en los días de sol
//      más fuerte. Los textos que decían "cada 1.5 h" también se corrigieron.
//   2. El push NO conocía la cadencia por TIPO DE EXPOSICIÓN. La app usa
//      `SPF_GAP_POR_EXPOSICION` desde el 2026-08-01: un día de interior espacia
//      a 4 h y uno de actividad física o agua aprieta a 70 min, porque el sudor
//      y el agua quitan el protector sin importar el UV. El push seguía
//      decidiendo solo por banda de UV, así que en un día de alberca avisaba
//      cada 2 h cuando debía hacerlo cada 70 min, y en un día de oficina
//      molestaba cada 2 h cuando bastaban 4.
//
// ⚠️ ESTA LÓGICA ESTÁ DUPLICADA A PROPÓSITO Y ES FRÁGIL.
// La fuente de verdad es `pure.js` (uvBand / spfGapHours / spfNudgeText /
// SPF_GAP_POR_EXPOSICION / SPF_MINUTOS_ANTES_DE_OCASO). Deno no puede importar
// el pure.js del repo, así que los MISMOS números viven en dos sitios: aquí y
// en la app. Cambiar uno sin el otro produce el peor fallo posible de este
// proyecto — uno silencioso: la app diría "siguiente en 2 h" y el push seguiría
// llegando cada 1.5 h, sin error en ningún lado. Ya pasó.
// Por eso existe `tests-spf-push-paridad.js`, que compara ambos archivos y
// falla si se separan. Si tocas los números de abajo, CÓRRELO.
// ⚠️ Y este archivo TIENE QUE VIVIR EN EL REPOSITORIO, junto a `pure.js`. Si
// solo existe dentro del dashboard de Supabase, la prueba no lo encuentra, se
// rinde y sale con éxito sin haber comparado nada — que es exactamente cómo
// estas dos divergencias sobrevivieron.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ── ESPEJO DE pure.js — mantener sincronizado ───────────────────────────────
// Corregido 2026-08-01 (replicado aquí el 2026-08-09): 2 h desde "alto" en
// adelante. La recomendación dermatológica estándar con exposición real son
// 2 h y NO se aprieta más aunque el UV sea máximo.
const SPF_GAP_POR_BANDA: Record<string, number | null> = {
  bajo: null, moderado: 3, alto: 2, muy_alto: 2, extremo: 2,
};
// Cadencia por TIPO DE EXPOSICIÓN. SUSTITUYE a la banda de UV cuando se conoce
// la exposición del día: el UV solo decide si hace falta protegerse EN ABSOLUTO
// ('bajo' = no), no cada cuánto. Sudar o nadar quita el protector sin importar
// qué tan fuerte pegue el sol en ese momento.
//   interior (con luz natural, cerca de ventanas) → 4 h
//   normal / alta / playa (aire libre directo)    → 2 h, sin excepción
//   actividad (actividad física o agua)           → 70 min, punto medio del
//     rango dermatológico de 60-80 min.
const SPF_GAP_POR_EXPOSICION: Record<string, number> = {
  interior: 4, normal: 2, alta: 2, playa: 2, actividad: 70 / 60,
};
const SPF_MINUTOS_ANTES_DE_OCASO = 60;
const SPF_HORA_INICIO = 8;
const GAP_FALLBACK_H = 2;   // sin dato de UV: no callarse, usar la base

function uvBand(uv: number | null): string | null {
  if (uv == null || isNaN(uv)) return null;
  if (uv < 3) return 'bajo';
  if (uv < 6) return 'moderado';
  if (uv < 8) return 'alto';
  if (uv < 11) return 'muy_alto';
  return 'extremo';
}
// Mismo orden de decisión que `spfGapHours` en pure.js, y en el mismo orden:
// 1) UV bajo veta el aviso pase lo que pase · 2) la exposición declarada manda
// sobre la banda · 3) sin dato de UV, la base de 2 h · 4) la banda.
function spfGapHours(uv: number | null, exposure?: string | null): number | null {
  const b = uvBand(uv);
  if (b === 'bajo') return null;
  if (exposure && SPF_GAP_POR_EXPOSICION[exposure] != null) return SPF_GAP_POR_EXPOSICION[exposure];
  if (b === null) return GAP_FALLBACK_H;
  return SPF_GAP_POR_BANDA[b];
}
function spfNudgeText(uv: number | null, horasDesdeUltimo: number | null) {
  const b = uvBand(uv);
  const desde = (horasDesdeUltimo == null || !isFinite(horasDesdeUltimo))
    ? 'Hoy aún no registras SPF facial'
    : `Han pasado ${horasDesdeUltimo.toFixed(1)} h desde tu último SPF`;
  const uvTxt = (uv == null || isNaN(uv)) ? '' : ` · UV ${Math.round(uv)}`;
  const porBanda: Record<string, { titulo: string; cola: string }> = {
    extremo:  { titulo: '🔴 UV extremo — reaplica ya', cola: 'Con este UV la sombra no es opcional: reaplica cada 2 h y busca techo entre 11 y 16 h.' },
    muy_alto: { titulo: '🔴 UV muy alto — reaplica ya', cola: 'Es el rango que más pigmenta tus manchas. Reaplica cada 2 h mientras estés fuera.' },
    alto:     { titulo: '🟠 Toca reaplicar SPF', cola: 'UV alto: cada 2 h si te da el sol, aunque estés tras una ventana.' },
    moderado: { titulo: '🟡 Toca reaplicar SPF', cola: 'UV moderado: cada 3 h basta hoy.' },
    bajo:     { titulo: '🟢 SPF al día', cola: 'UV bajo: no hace falta reaplicar por ahora.' },
  };
  const p = porBanda[b ?? ''] ?? { titulo: '☀️ Toca reaplicar SPF', cola: 'Sin dato de UV — se asume el ritmo normal de 2 h.' };
  return { titulo: p.titulo, cuerpo: `${desde}${uvTxt}. ${p.cola}` };
}
// ── FIN DEL ESPEJO ──────────────────────────────────────────────────────────

const TZ = 'America/Mexico_City';
const LAT = 20.67, LON = -103.35;   // Guadalajara, igual que en app.js

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
}

// UV actual y ocaso, del mismo endpoint que usa la app (Open-Meteo, sin key).
// DEFENSIVO: si falla, se devuelve todo null y la función sigue con el
// comportamiento viejo (2 h y corte a las 19). Quedarse sin avisar porque un
// servicio de terceros no respondió sería peor que avisar de más.
async function fetchClima(): Promise<{ uv: number | null; sunsetMs: number | null }> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&current=uv_index&daily=sunset&forecast_days=1&timezone=${encodeURIComponent(TZ)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const uv = (j?.current?.uv_index != null) ? Number(j.current.uv_index) : null;
    let sunsetMs: number | null = null;
    const s = j?.daily?.sunset?.[0];
    if (s) {
      // Viene como hora local SIN zona ("2026-07-26T20:14"). En Deno el reloj
      // es UTC, así que hay que pegarle el offset de Guadalajara a mano: si se
      // parseara como UTC, el ocaso se correría 6 h y el corte no llegaría
      // nunca.
      const t = new Date(`${String(s).replace(' ', 'T')}:00-06:00`);
      if (!isNaN(t.getTime())) sunsetMs = t.getTime();
    }
    return { uv, sunsetMs };
  } catch (_e) {
    return { uv: null, sunsetMs: null };
  }
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    webpush.setVapidDetails(
      'mailto:macapersonal.09@gmail.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );

    const now = new Date();
    const gdlHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', hour12: false
    }).format(now));

    const { uv, sunsetMs } = await fetchClima();

    // 1. UV por debajo de 3: no hay nada que reaplicar, y ninguna exposición
    //    cambia eso (mismo corte que `spfGapHours` en pure.js).
    if (uvBand(uv) === 'bajo') return json({ skipped: 'uv_bajo', uv });
    // 2. Muy temprano. (8 en vez de 10: en verano a las 8:30 el UV ya sube.)
    if (gdlHour < SPF_HORA_INICIO) return json({ skipped: 'muy_temprano', gdlHour });
    // 3. Ocaso real, con 60 min de margen. Sin dato, el corte viejo de las 19.
    if (sunsetMs != null) {
      if (now.getTime() > sunsetMs - SPF_MINUTOS_ANTES_DE_OCASO * 60000) {
        return json({ skipped: 'ocaso', sunset: new Date(sunsetMs).toISOString() });
      }
    } else if (gdlHour >= 19) {
      return json({ skipped: 'noche_sin_dato_de_ocaso', gdlHour });
    }

    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now); // YYYY-MM-DD

    // 4. La exposición que ella declaró HOY manda sobre la banda de UV. Si no
    //    la registró todavía, `exposure` queda null y se cae a la banda, que es
    //    el comportamiento que este archivo tenía antes.
    const { data: nota } = await supabase.from('daily_notes')
      .select('sun_exposure').eq('note_date', localDate).maybeSingle();
    const exposure: string | null = (nota && nota.sun_exposure) ? nota.sun_exposure : null;

    const gapH = spfGapHours(uv, exposure);
    if (gapH == null) return json({ skipped: 'uv_bajo', uv });

    const { data: spfProducts } = await supabase.from('products')
      .select('id').eq('category', '🌞 SPF Facial');
    const ids = (spfProducts ?? []).map((p: { id: string }) => p.id);
    if (!ids.length) return json({ skipped: 'sin productos SPF' });

    const startISO = new Date(localDate + 'T00:00:00-06:00').toISOString();
    const { data: apps } = await supabase.from('product_applications')
      .select('applied_at').in('product_id', ids).gte('applied_at', startISO)
      .order('applied_at', { ascending: false }).limit(1);
    const last = apps?.length ? new Date(apps[0].applied_at) : null;
    const desdeUltimo = last ? (now.getTime() - last.getTime()) / 3600000 : Infinity;
    if (desdeUltimo < gapH) {
      return json({ skipped: 'spf reciente', gapH, exposure, desdeUltimo: Number(desdeUltimo.toFixed(2)) });
    }

    // El antirrebote usa el MISMO plazo dinámico: en un día de actividad el
    // aviso puede repetirse a los 70 min, no a las 2 h.
    const cutoff = new Date(now.getTime() - gapH * 3600000).toISOString();
    const { data: subs } = await supabase.from('push_subscriptions').select('*')
      .or(`last_notified_at.is.null,last_notified_at.lt.${cutoff}`);
    if (!subs?.length) return json({ skipped: 'sin suscripciones pendientes' });

    const msg = spfNudgeText(uv, last ? desdeUltimo : null);
    const payload = JSON.stringify({ title: msg.titulo, body: msg.cuerpo });

    let sent = 0, removed = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        await supabase.from('push_subscriptions')
          .update({ last_notified_at: now.toISOString() }).eq('id', s.id);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
          removed++;
        }
      }
    }
    return json({
      sent, removed, uv, gapH, exposure,
      banda: uvBand(uv),
      titulo: msg.titulo,
      desdeUltimo: Number(desdeUltimo.toFixed(2)),
      sunset: sunsetMs ? new Date(sunsetMs).toISOString() : null
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
