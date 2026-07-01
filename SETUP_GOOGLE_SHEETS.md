# Configurar la conexión a Google Sheets

Sigue estos pasos una sola vez. Al final tendrás 3 valores para pegar en `.env.local`.

## 1. Crear un proyecto en Google Cloud

1. Ve a https://console.cloud.google.com/
2. Arriba a la izquierda, junto a "Google Cloud", haz clic en el selector de proyecto → **Proyecto nuevo**.
3. Nómbralo, por ejemplo, `inteligencia-comercial`, y créalo.

## 2. Habilitar la API de Google Sheets

1. Con el proyecto seleccionado, ve a **APIs y servicios → Biblioteca**.
2. Busca "Google Sheets API" y haz clic en **Habilitar**.

## 3. Crear la cuenta de servicio

1. Ve a **APIs y servicios → Credenciales**.
2. Clic en **Crear credenciales → Cuenta de servicio**.
3. Nombre: por ejemplo `sheets-bot`. Clic en **Crear y continuar**, luego **Listo** (no hace falta darle roles de proyecto).
4. En la lista de cuentas de servicio, haz clic en la que acabas de crear.
5. Pestaña **Claves → Agregar clave → Crear clave nueva → JSON**. Se descarga un archivo `.json`.
6. Abre ese archivo. Necesitas dos campos:
   - `client_email` → va en `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → va en `GOOGLE_PRIVATE_KEY` (cópialo completo, incluyendo `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`)

**Importante**: este archivo `.json` es una credencial sensible. No lo subas al repositorio ni lo compartas.

## 4. Crear la hoja de cálculo y compartirla

1. Ve a https://sheets.new para crear una hoja nueva (o usa una existente).
2. Nómbrala, por ejemplo, "Inteligencia Comercial - Artículos Deportivos".
3. Clic en **Compartir**, pega el `client_email` de la cuenta de servicio (termina en `.iam.gserviceaccount.com`) y dale permiso de **Editor**.
4. Copia el ID de la hoja desde la URL:
   `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit` → ese valor va en `GOOGLE_SHEET_ID`.

## 5. Configurar el proyecto

1. Copia `.env.local.example` a `.env.local`:
   ```
   cp .env.local.example .env.local
   ```
2. Completa los 3 valores en `.env.local` con los datos obtenidos arriba.

## 6. Probar la conexión

1. Instala dependencias si no lo has hecho: `npm install`
2. Corre el servidor: `npm run dev`
3. Abre en el navegador: http://localhost:3000/api/sheets/test

Si todo está bien configurado, verás una respuesta JSON con `"ok": true` y las pestañas creadas automáticamente en tu hoja: `Proveedores`, `Clientes_Potenciales`, `Log_Investigaciones`, `Reportes`.

Si hay un error, el mensaje indica qué falta (variable de entorno faltante, hoja no compartida con la cuenta de servicio, etc.).
