# Plataforma de Inteligencia Comercial — Artículos Deportivos (TX, FL, CA)

## Objetivo general

Plataforma que automatiza la investigación comercial para encontrar proveedores y clientes potenciales de artículos deportivos en Texas, Florida y California, valida la información pública encontrada, la almacena en Google Sheets, y la expone mediante un dashboard web con chat inteligente.

## Objetivos funcionales

1. Buscar automáticamente proveedores de artículos deportivos.
2. Buscar automáticamente clientes potenciales.
3. Extraer información pública de cada empresa.
4. Obtener datos de contacto.
5. Encontrar redes sociales oficiales.
6. Validar la información encontrada.
7. Evitar registros duplicados.
8. Almacenar toda la información validada en Google Sheets.
9. Mostrar toda la información desde un dashboard web.
10. Permitir consultas mediante un chat inteligente.
11. Generar reportes profesionales.
12. Actualizar automáticamente la información cada tres días.
13. Permitir búsquedas manuales cuando el usuario lo solicite.

## Alcance

- **Industria**: artículos deportivos (proveedores/fabricantes/mayoristas y clientes potenciales: tiendas, gimnasios, clubes, escuelas).
- **Geografía**: Texas, Florida y California.

## Decisión de almacenamiento

**Google Sheets es la única fuente de datos** (sin base de datos adicional), por decisión explícita del usuario. Trade-off aceptado: a medida que el volumen de filas crezca mucho, la lectura vía API puede volverse más lenta; se puede mitigar en el futuro con una caché de solo lectura sin cambiar dónde vive el dato.

### Estructura de la hoja de cálculo (pestañas)

| Pestaña | Contenido |
|---|---|
| `Proveedores` | Empresa, estado (TX/FL/CA), web, email, teléfono, redes sociales, fecha de validación, fuente |
| `Clientes_Potenciales` | Mismo esquema, para tiendas/gimnasios/clubes/escuelas |
| `Log_Investigaciones` | Historial de cada corrida del pipeline (automática o manual): qué se buscó, cuántos nuevos, cuántos actualizados |
| `Reportes` | Metadatos de reportes generados (fecha, link al PDF) |

## Stack técnico

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend/Dashboard | Next.js 15 (App Router) + Tailwind + shadcn/ui | Un solo repo, deploy con un `git push` a Vercel |
| Chat inteligente | Vercel AI SDK + Claude (Anthropic API) | Streaming, tool-calling para disparar búsquedas/investigaciones |
| Almacenamiento | Google Sheets API (cuenta de servicio) | Fuente única de datos, editable por el equipo |
| Automatización | Vercel Cron Jobs + Inngest (o Trigger.dev) | Jobs en background con reintentos, sin timeout de serverless |
| Auth | Clerk o Auth.js | Login del equipo comercial al dashboard |

## Pipeline unificado (automático y manual)

```
Trigger (cron cada 3 días | botón manual | comando de chat)
        │
        ▼
1. Discovery      → candidatos (proveedores/clientes) en TX, FL, CA
        │
        ▼
2. Extracción      → info pública, contacto, redes sociales (Claude + APIs)
        │
        ▼
3. Validación      → dominio activo, email/teléfono con formato válido, redes verificadas
        │
        ▼
4. Dedup (en memoria contra filas existentes de Sheets)
        │
        ▼
5. Escritura/actualización en Google Sheets
        │
        ▼
6. Dashboard/Chat reflejan el cambio; reportes disponibles bajo demanda
```

### Dedup y validación sin base de datos

Cada corrida del pipeline:
1. Carga en memoria las filas existentes de `Proveedores`/`Clientes_Potenciales` vía Google Sheets API.
2. Compara cada candidato nuevo contra esa lista (nombre normalizado + dominio + teléfono, fuzzy matching) para decidir "actualizar fila existente" vs "insertar nueva".
3. Escribe el resultado de vuelta a Sheets.

## Fuentes de datos

**Gratis / oficiales:**
- SEC EDGAR (empresas públicas)
- OpenCorporates (registro de sociedades)
- Secretarías de Estado de TX, FL, CA (verificación legal)
- Google Places/My Business API (dirección, teléfono, categoría — clave para tiendas, gimnasios, clubes)

**Específicas de artículos deportivos:**
- ThomasNet (directorio de fabricantes/mayoristas)
- SFIA (Sports & Fitness Industry Association) — directorio de miembros

**Motor de investigación con IA:**
- Claude con web search tool como capa final para completar/estructurar datos que las APIs no cubren, y para localizar/verificar redes sociales oficiales.

## Requisito técnico pendiente

Cuenta de servicio de Google Cloud con acceso a la hoja de cálculo, para conectar la plataforma vía Google Sheets API.

## Fases sugeridas

1. **Fase 1**: dashboard + pipeline de investigación manual (bajo demanda) + integración con Google Sheets.
2. **Fase 2**: automatización con cron cada 3 días + detección/dedup contra Sheets existente.
3. **Fase 3**: reportes profesionales (PDF) y chat con tool-calling completo.
