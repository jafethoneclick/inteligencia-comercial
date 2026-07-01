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
  radio (no permite buscar "todo el estado" de una vez), así que se usa una
  ciudad grande representativa de cada estado como ancla (Houston para TX,
  Miami para FL, Los Ángeles para CA). Esto significa que no cubre todo el
  estado, solo el área metropolitana de esa ciudad — aceptable para el
  volumen que maneja este proyecto, pero es una limitación real.
  Si hace falta más cobertura, la forma de mejorar esto es agregar más
  ciudades por estado en `CIUDAD_POR_ESTADO` y hacer una llamada por ciudad.
- Yelp no da el sitio web propio del negocio (`sitio_web` queda vacío para
  estos candidatos) ni email. En cambio sí da dirección física exacta y
  teléfono verificado — por eso se agregó el campo `direccion` al esquema, y
  `validation.ts` acepta un candidato sin sitio web siempre que tenga
  dirección.
- El link de Google Maps (`buildGoogleMapsUrl`) usa la dirección real cuando
  existe, en vez de solo "empresa, estado, USA" — da un pin mucho más
  preciso para los candidatos de Yelp.

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

## 5. Cosas que NO aplican en producción

- El workaround del archivo `hosts` (`104.16.5.34 registry.npmjs.org`) fue
  solo para arreglar una resolución DNS rota en la máquina de desarrollo
  local. El entorno de build de Vercel no lo necesita — no hay que
  replicarlo ahí.

## 6. Checklist rápida antes de cada deploy a producción

- [ ] Todas las variables de la sección 1 cargadas en Vercel (Production).
- [ ] Private key de Google rotada (ver nota de seguridad arriba).
- [ ] `CRON_SECRET` definido en Vercel.
- [ ] Hoja de Sheets de producción compartida con la cuenta de servicio.
- [ ] Probado `/api/cron/research` a mano una vez tras el deploy.
- [ ] Confirmado el plan de Vercel soporta la duración de función necesaria.
