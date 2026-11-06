# Actividad 20 – Almacenamiento en la nube para archivos multimedia (Incidencias)

App de reporte de incidencias que permite elegir una foto (galería o cámara), verla previamente, validarla, subirla a **Supabase Storage** y volver a mostrarla desde la nube. En la base de datos solo se guarda la **ruta** del archivo, no la imagen.

## Cómo ejecutarla

### 1. Configurar Supabase (gratis)
1. Crea un proyecto en https://supabase.com.
2. **Authentication → Sign In / Providers →** activa **Allow anonymous sign-ins**.
3. **SQL Editor →** pega y ejecuta `supabase.sql` (crea el bucket privado, las políticas y la tabla).
4. **Project Settings → API:** copia la *Project URL* y la clave pública (*anon* o *publishable*).

### 2. Ejecutar la app
```bash
cd incidencias-act20
npm install
```
El archivo `.env` ya está configurado con la URL y la clave pública del proyecto de Supabase. Después:
```bash
npx expo start
```
Escanea el QR con **Expo Go**. Los permisos de cámara y galería ya están configurados en `app.json`. Proyecto creado con Expo SDK 58.

## Parte 1 – Servicio seleccionado

| Concepto | Supabase Storage |
|----------|------------------|
| **Nombre del servicio** | Supabase Storage (almacenamiento de objetos compatible con S3, integrado con Supabase Auth y Postgres) |
| **Tipos de archivo permitidos** | Cualquiera por defecto. En este bucket se restringió a `image/jpeg`, `image/png` e `image/webp` con `allowed_mime_types`. |
| **Tamaño máximo** | Configurable por bucket; aquí **5 MB** (`file_size_limit = 5242880`). El plan gratuito permite archivos de hasta 50 MB y 1 GB de almacenamiento total. |
| **Mecanismo de carga** | API REST / SDK `@supabase/supabase-js`: `storage.from('incidencias').upload(ruta, ArrayBuffer, { contentType })` sobre HTTPS, autenticado con el JWT del usuario. |
| **Acceso y seguridad** | Bucket **privado**. Acceso controlado con políticas **RLS** sobre `storage.objects`. Lectura mediante **URLs firmadas** temporales (`createSignedUrl`, 1 hora). |

## Parte 2 – Funcionalidad móvil
1. Pantalla de registro con título y descripción.
2. Botones **Galería** y **Cámara** (`expo-image-picker`), con su solicitud de permisos.
3. Vista previa de la imagen antes de subirla.
4. Carga: se lee el archivo como `ArrayBuffer` y se sube a `incidencias/<id-usuario>/<timestamp>.jpg`.
5. Recuadro con el resultado (éxito o error y su motivo).
6. Se muestra la referencia (`incidencias/<uid>/…`) y la URL firmada.

## Parte 3 – Consulta y visualización
1. La ruta se guarda en la tabla `incidencias`. Al consultar se generan URLs firmadas con `createSignedUrls`.
2. La lista **Mis incidencias** muestra las imágenes descargadas del almacenamiento remoto.
3. La sesión anónima se guarda en `AsyncStorage`, así que al **cerrar y abrir la app** se recupera el mismo usuario y sus imágenes.
4. **Información que se guarda en la base de datos** para relacionar la imagen con la incidencia:

| Campo | Por qué |
|-------|---------|
| `id` | Identificador de la incidencia |
| `user_id` | Quién la reportó (sirve para las políticas de acceso) |
| `titulo`, `descripcion` | Datos del reporte |
| `imagen_path` | **Ruta del archivo en el bucket.** Se guarda la ruta y no la URL, porque la URL firmada caduca y se genera cada vez que se consulta. |
| `created_at` | Fecha del reporte |

Flujo implementado (igual al `Ejemplo_flujo.png`): App → Seleccionar imagen → Validar → Supabase Storage → Guardar archivo → Obtener ruta/URL firmada → Mostrar imagen.

## Parte 4 – Seguridad y pruebas

| Prueba | Cómo hacerla / resultado esperado |
|--------|-----------------------------------|
| Formato no permitido | Toca **"Elegir video/GIF"** y elige un video o GIF → *"Formato no permitido"*. Si activas **"Omitir validación local"**, el **servidor** lo rechaza por `allowed_mime_types`, lo que demuestra la doble validación. |
| Pérdida de conexión | Activa el modo avión e intenta subir → *"Sin conexión a internet"* (se comprueba con `expo-network` antes de subir y el error se captura si la red cae durante la carga). |
| Restricciones de acceso | Bucket privado; políticas que solo permiten `insert`/`select` dentro de la carpeta `<auth.uid()>`. |
| Sin claves privadas en la app | Solo se usa la clave pública en `.env`. La `service_role` nunca sale del panel de Supabase. `.env` debe estar en `.gitignore`. |
| Carga autorizada | Solo usuarios autenticados (rol `authenticated`) pueden subir, y únicamente a su carpeta. |
| Archivos privados sin autorización | En cada incidencia, toca **"Probar acceso sin autorización"**: se pide la URL pública del archivo sin token y el servidor responde con error 400/404 → *"Acceso denegado"*. |

## Parte 5 – Evidencias que debes capturar
1. Imagen seleccionada en la vista previa.
2. Mensaje de **carga exitosa** con la referencia.
3. Supabase → **Storage → incidencias → (carpeta del usuario)** con el archivo (evidencia en la nube).
4. Lista **Mis incidencias** con la imagen recuperada después de cerrar y abrir la app.
5. Error por formato no permitido, error sin conexión y alerta de *"Acceso denegado"*.
6. Captura de las políticas en **Storage → Policies** y de la configuración del bucket.

## Entregable 6 – Mecanismos de seguridad (resumen)
- **Bucket privado:** ningún archivo es accesible por URL pública.
- **Políticas RLS** en `storage.objects` y en la tabla: cada usuario solo sube y ve lo suyo.
- **URLs firmadas** con caducidad de 1 hora para mostrar las imágenes.
- **Validación doble:** en la app (tipo y tamaño) y en el servidor (`allowed_mime_types` y `file_size_limit`).
- **Autenticación** (usuario anónimo con JWT) obligatoria para subir.
- **Solo la clave pública** en la app; nada de credenciales administrativas.
- **HTTPS** en todas las transferencias.
