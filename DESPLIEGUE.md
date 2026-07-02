# Notas de despliegue (Vercel)

Este archivo reúne todo lo que hay que hacer/recordar al desplegar el proyecto.
Se va actualizando a medida que aparecen cosas nuevas — no es documentación de
arquitectura (eso está en `ARCHITECTURE.md`), es una checklist operativa.

## 1. Variables de entorno a configurar en Vercel

En el proyecto de Vercel: Settings → Environment Variables. Deben cargarse ahí
(nunca subirse a git; `.env.local` está en `.gitignore`).

| Variable | Valor | Notas |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | email de la cuenta de servicio | termina en `.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | clave privada del JSON descargado | debe incluir las comillas y los `\n` literales, igual que en `.env.local` |
| `GOOGLE_SHEET_ID` | ID de la hoja de cálculo | el que está entre `/d/` y `/edit` en la URL |
| `GROQ_API_KEY` | API key de Groq | opción temporal/gratuita; si está definida, el pipeline usa Groq en vez de Anthropic (ver sección 1a) |
| `GROQ_MODEL` | opcional, por defecto `groq/compound` | debe ser un modelo "compound" (con búsqueda web), no un Llama/Qwen normal |
| `GROQ_CHAT_MODEL` | opcional, por defecto `llama-3.3-70b-versatile` | usado solo por `/api/chat`; a diferencia de `GROQ_MODEL`, aquí sí conviene un modelo normal (no "compound") porque el chat necesita "tool calling" confiable, no búsqueda web |
| `ANTHROPIC_API_KEY` | API key de Anthropic | sin ninguna de las dos (Groq o Anthropic), `/api/research`, el cron y `/api/chat` fallan |
| `ANTHROPIC_MODEL` | opcional, por defecto `claude-sonnet-5` | |
| `CRON_SECRET` | cualquier cadena aleatoria | protege `/api/cron/research`; Vercel la envía sola como `Authorization: Bearer <valor>` al invocar el cron (ver sección 3) |
| `YELP_API_KEY` | opcional, API key de Yelp Fusion | complementa la búsqueda de clientes potenciales con dirección/teléfono reales (ver sección 1b); si no está definida, el pipeline sigue funcionando solo con la IA |
| `DASHBOARD_USER` | usuario para el login del dashboard | **definir siempre en producción** — sin esto (o sin `DASHBOARD_PASSWORD`), el sitio queda sin protección (ver sección 1c) |
| `DASHBOARD_PASSWORD` | contraseña para el login del dashboard | ídem |

**Pendiente de seguridad:** la private key que usamos en desarrollo se pegó en
texto plano en este chat en algún momento. Antes de ir a producción, rotarla
(generar una nueva clave para la cuenta de servicio en GCP Console y borrar la
vieja) y usar la nueva tanto en `.env.local` como en Vercel.

### 1a. Proveedor de investigación (Groq ↔ Anthropic)

`src/lib/research.ts` elige el proveedor automáticamente: si `GROQ_API_KEY`
está definida la usa (Groq, con el modelo de `GROQ_MODEL`); si no, usa
`ANTHROPIC_API_KEY`. Para cambiar de proveedor en cualquier momento (ej. de
la key temporal de Groq a la definitiva de Anthropic) **no hay que tocar
código**, solo las variables de entorno: quitar/vaciar `GROQ_API_KEY` para
que caiga a Anthropic, o viceversa. Importante: con Groq, el modelo debe ser
uno de la familia "compound" (`groq/compound` o `groq/compound-mini`), que
trae búsqueda web integrada — los modelos normales (Llama, Qwen, etc.) no
buscan en la web y el pipeline inventaría datos falsos.

**Detalles técnicos encontrados al probar Groq (ya resueltos en el código,
documentados por si se repiten o se depura algo parecido):**
- La llamada a Groq en `researchWithGroq()` usa `node:https` directamente en
  vez del `fetch()` global. El `fetch` de Next.js está parcheado para su
  caché de datos y manda el body con "chunked encoding" sin
  `Content-Length`; el proxy de Groq a veces lo rechaza con un 413 "Request
  Entity Too Large" aunque el body sea de pocos KB. No usar `fetch()` para
  esta llamada sin probar bien si se vuelve a tocar este archivo.
- El tier gratuito de Groq tiene un límite bajo de tokens por minuto (30,000
  TPM visto en pruebas) compartido entre todos los modelos internos que usa
  `compound` (hace varias llamadas internas por cada búsqueda). Con cuentas
  gratuitas, esperar ~20-30s entre corridas si se recibe 429.
- Es necesario mandar `max_tokens` explícito (usamos 8192) en el request a
  Groq. Sin esto, la respuesta se puede cortar a mitad del JSON (visto en
  pruebas: el modelo generó URLs con caracteres Unicode decorativos/en
  negrita que consumen muchos tokens y trunca la respuesta antes del cierre
  del array JSON).
- Groq `compound`/`compound-mini` a veces genera datos con URLs mal
  formadas o de baja calidad (ej. un sitio no relacionado al rubro). La capa
  de validación (`src/lib/validation.ts`) ya filtra esto revisando que el
  sitio web responda, pero conviene revisar manualmente los primeros
  resultados de cada corrida hasta confirmar que la calidad es aceptable.

### 1b. Yelp como fuente complementaria (solo clientes potenciales)

`src/lib/yelp.ts` busca en Yelp Fusion API (`/v3/businesses/search`) tiendas
deportivas, gimnasios y clubes en TX/FL/CA, y se agrega a los candidatos que
ya encontró la IA antes de validar/deduplicar (ver `pipeline.ts`). Solo
corre si `YELP_API_KEY` está definida y solo para `tipo=clientes` — no
aplica a proveedores/mayoristas porque Yelp es un directorio de consumo,
no B2B. Si Yelp falla (rate limit, key inválida, etc.), el pipeline sigue
con lo que ya tenía de la IA; nunca hace fallar toda la corrida.

Detalles a tener en cuenta:
- La API de búsqueda de Yelp centra la búsqueda en un punto geográfico + un
  radio (no permite buscar "todo el estado" de una vez), así que se
  aproxima cubriendo varias ciudades grandes por estado como anclas
  (`CIUDADES_POR_ESTADO`: 6 para TX, 5 para FL, 5 para CA). Con una sola
  ciudad por estado, correr la búsqueda varias veces solo volvía a
  encontrar los mismos negocios ya guardados (se agotaba rápido el radio de
  una sola ciudad); con varias ciudades el universo de negocios
  encontrables es mucho más amplio. Sigue sin ser "todo el estado" — es una
  aproximación con las ciudades más grandes.
- Yelp no da el sitio web propio del negocio (`sitio_web` queda vacío para
  estos candidatos) ni email. En cambio sí da dirección física exacta y
  teléfono verificado — por eso se agregó el campo `direccion` al esquema, y
  `validation.ts` acepta un candidato sin sitio web siempre que tenga
  dirección.
- El link de Google Maps (`buildGoogleMapsUrl`) usa la dirección real cuando
  existe, en vez de solo "empresa, estado, USA" — da un pin mucho más
  preciso para los candidatos de Yelp.

### 1c. Login del dashboard

`src/proxy.ts` protege todo el sitio (páginas y rutas API) con HTTP
Basic Auth simple, comparando contra `DASHBOARD_USER`/`DASHBOARD_PASSWORD`.
Es un login único compartido por el equipo, sin gestión de usuarios — para
un equipo interno chico es suficiente, y evita depender de un proveedor de
auth externo (Clerk/Auth.js) con su propia cuenta y setup. (Nota: en
Next.js 16 el archivo `middleware.ts` se renombró a `proxy.ts` — la función
exportada se llama `proxy`, no `middleware`.)

- `/api/cron/research` queda **excluido** de este chequeo (ver `matcher` en
  `proxy.ts`) porque ya tiene su propia protección con `CRON_SECRET`,
  y Vercel Cron no manda credenciales Basic Auth.
- Si `DASHBOARD_USER`/`DASHBOARD_PASSWORD` no están definidas, el proxy
  no bloquea nada (para no dejar el dashboard inaccesible por accidente en
  desarrollo si se olvida configurarlas) — **por eso es crítico definirlas
  en Vercel antes de considerar el sitio "protegido" en producción**.
- Es un login compartido, no hay botón de "cerrar sesión" — hay que cerrar
  el navegador o borrar el permiso guardado del sitio para salir.

### 1d. OpenStreetMap (Overpass API) como fuente de volumen (proveedores y clientes)

`src/lib/osm.ts` consulta la Overpass API pública
(`https://overpass-api.de/api/interpreter`) para traer negocios reales
etiquetados en OpenStreetMap dentro de TX/FL/CA, y se agrega a los
candidatos de la corrida junto con la IA y Yelp (ver `pipeline.ts`).

**No requiere ninguna API key ni variable de entorno** — a diferencia de
todas las demás integraciones de este proyecto (Groq/Anthropic, Yelp,
Google Sheets), Overpass es un servicio público y gratuito sin
autenticación. Corre siempre, para ambos tipos (`proveedores` y
`clientes`), sin ningún flag para activarlo/desactivarlo.

- Es la fuente principal de *volumen*: la IA está limitada a un máximo bajo
  por corrida (`AI_CANTIDAD_MAX` en `pipeline.ts`) porque cada llamada a
  Groq/Anthropic cuesta cuota y tiempo; OSM puede devolver cientos de
  resultados por estado en una sola consulta sin ese costo. Por eso el
  input de "cantidad" del formulario manual soporta hasta 1200.
- Cobertura desigual por diseño: para `clientes` (tiendas deportivas,
  gimnasios, clubes) OSM tiene etiquetas específicas y bien establecidas
  (`shop=sports`, `shop=outdoor`, `leisure=fitness_centre`,
  `leisure=sports_centre`, `club=sport`) y suele aportar muchos resultados.
  Para `proveedores` (mayoristas/fabricantes B2B) la cobertura es mucho más
  débil — la mayoría de mayoristas no se mapean en OSM porque no son
  lugares que el público visite — así que ese branch (`shop=wholesale`,
  `office=company`) puede devolver pocos o ningún resultado. Esto es
  esperado: la IA sigue siendo la fuente principal/confiable para
  proveedores, OSM ahí es solo un extra oportunista.
- Muchos elementos de OSM no tienen `website` (a diferencia de la IA, que
  siempre intenta encontrar uno) — `validation.ts` ya maneja esto
  aceptando candidatos sin sitio web si tienen `direccion`, igual que con
  Yelp. A diferencia de Yelp, OSM sí trae `email` en algunos casos, cuando
  el mapeador lo cargó.
- El servidor público de Overpass es compartido y puede estar lento o dar
  rate limit en horas pico. `osm.ts` manda `[timeout:60]` en cada query y
  atrapa errores por estado (si un estado falla, se sigue con los demás) —
  nunca bloquea toda la corrida, mismo patrón de resiliencia que Yelp.
- Si en el futuro hace falta más volumen/confiabilidad, la alternativa es
  correr una instancia propia de Overpass (Docker) o usar un mirror privado
  de pago — no hecho por ahora porque el servidor público ya alcanza el
  volumen pedido (~1000+/corrida) sin ningún costo ni setup.

### 1e. SerpApi como fuente complementaria para proveedores

`src/lib/serpapi.ts` complementa la búsqueda de **proveedores**
(mayoristas/fabricantes B2B) con resultados reales de Google Local vía
SerpApi. Es el espejo de Yelp (que solo aplica a clientes): a diferencia de
OSM, que solo encuentra negocios con los tags fijos de OpenStreetMap,
SerpApi busca con texto libre (`"sporting goods wholesale distributor"`),
así que encuentra distribuidores que sí tienen presencia local pero nunca
se mapearon en OSM — llenando el hueco que OSM deja en proveedores.

- Opcional: solo corre si `SERPAPI_API_KEY` está definida. Si no, el
  pipeline sigue funcionando igual con IA + OSM.
- Igual que Yelp, cubre varias ciudades por estado (`CIUDADES_POR_ESTADO`
  en `serpapi.ts`), pero con una lista más corta (3 por estado en vez de
  5-6): SerpApi solo da **250 búsquedas gratis/mes** (vs. Yelp, que da
  500/día), así que cada ciudad extra consume cuota real. Si el uso crece,
  ajustar esta lista es el primer lugar donde recortar.
- Igual que Yelp, no da `email` ni `sitio_web` (confirmado probando en
  vivo: el endpoint de Google Local no incluye el sitio propio del
  negocio) — solo nombre, dirección, categoría y teléfono. `validation.ts`
  acepta el candidato igual porque sí hay dirección.
- Nunca bloquea la corrida: si falla para un estado (rate limit, key
  inválida), se atrapa el error y se sigue con los demás.

## 2. Google Sheets

- La hoja de cálculo debe estar compartida con el email de la cuenta de
  servicio (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) con permiso de **Editor**.
- Si en algún momento se usa una hoja distinta para producción (en vez de la
  misma de desarrollo), hay que compartirla también y actualizar
  `GOOGLE_SHEET_ID` en Vercel.
- Las pestañas (`Proveedores`, `Clientes_Potenciales`, `Log_Investigaciones`,
  `Reportes`) se crean solas la primera vez que corre cualquier endpoint
  (`ensureSheetsReady()`), no hace falta crearlas a mano.

## 3. Cron de actualización automática

- Configurado en `vercel.json`: llama a `GET /api/cron/research` todos los
  días a las 8am UTC.
- El endpoint decide internamente si realmente ejecuta o se salta (revisa la
  última fila `tipo=automatica` en `Log_Investigaciones` y solo corre si ya
  pasaron 3+ días) — así que aunque el cron dispare todos los días, el
  pipeline real de Claude solo corre cada 3 días.
- Si se define `CRON_SECRET`, Vercel lo manda automáticamente como header
  `Authorization: Bearer <CRON_SECRET>` al invocar el cron (esto lo hace
  Vercel solo, no hay que configurar nada más). Si la variable no está
  definida, el endpoint no exige autenticación — **definirla antes de
  desplegar a producción**, si no cualquiera con la URL puede disparar
  búsquedas y gastar la API key de Anthropic.
- Después del primer deploy, probar el endpoint a mano una vez para
  confirmar que funciona, antes de confiar en el schedule:
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<tu-dominio>.vercel.app/api/cron/research`

## 4. Duración de las funciones (maxDuration)

- `/api/research` y `/api/cron/research` declaran `maxDuration = 300` (5
  minutos), porque el pipeline hace varias búsquedas web con Claude más
  validación de dominios.
- **Ojo con el plan de Vercel:** el plan Hobby limita la duración máxima de
  funciones (bastante menos de 300s); el plan Pro permite llegar a 300s. Si
  el proyecto está en Hobby, el cron o las búsquedas grandes pueden cortarse
  a mitad. Si pasa eso: subir de plan, o bajar `cantidad`/número de estados
  por corrida para que termine más rápido.
- Desde que OSM (ver sección 1d) permite pedir cientos/miles de candidatos
  por corrida, `pipeline.ts` escribe en Sheets en **lote** (`appendRows` /
  `batchUpdateRows`: una sola llamada HTTP para todas las filas nuevas, otra
  para todas las actualizadas) en vez de una llamada por fila. Esto es lo
  que hace viable correr a 1000+ candidatos sin pasarse de la cuota de la
  API de Sheets (300 req/min por proyecto, 60/min por usuario) ni del
  `maxDuration`. La validación de candidatos también corre con concurrencia
  limitada (`mapWithConcurrency`, 15 en paralelo) en vez de secuencial, por
  la misma razón.

## 5. Cosas que NO aplican en producción

- El workaround del archivo `hosts` (`104.16.5.34 registry.npmjs.org`) fue
  solo para arreglar una resolución DNS rota en la máquina de desarrollo
  local. El entorno de build de Vercel no lo necesita — no hay que
  replicarlo ahí.

## 6. Checklist rápida antes de cada deploy a producción

- [x] Todas las variables de la sección 1 cargadas en Vercel (Production).
- [ ] Private key de Google rotada (ver nota de seguridad arriba) — **sigue pendiente**.
- [x] `CRON_SECRET` definido en Vercel.
- [x] Hoja de Sheets de producción compartida con la cuenta de servicio.
- [x] Probado `/api/cron/research` a mano una vez tras el deploy (confirmado 401 sin auth).
- [ ] Confirmado el plan de Vercel soporta la duración de función necesaria (revisar si el plan es Hobby o Pro).

## 7. Deploy en vivo

- Repo: `github.com/jafethoneclick/inteligencia-comercial` (privado).
- Producción: https://inteligencia-comercial-beta.vercel.app/
- Confirmado post-deploy (fecha del primer deploy): homepage 200, `/api/sheets/test` ok,
  dashboard con las 3 secciones (chat, búsqueda, reportes), `/api/chat` respondiendo con
  datos reales, `/api/cron/research` devuelve 401 sin `Authorization`.
