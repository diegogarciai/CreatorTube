# Fase 0 · Trámites para arrancar

Estos trámites deciden el calendario y no dependen del código. Google no publica plazos firmes: pídelos desde la semana 2 y tenlos aprobados antes de invitar a otros creadores.

## Lista

- [ ] Elegir nombre y dominio definitivos (sin "YouTube" ni "YT"). Cambiar `packages/config/src/brand.ts`.
- [ ] Crear el proyecto en Google Cloud con la cuenta de la empresa.
- [ ] Publicar en el dominio: página de inicio (`/`), política de privacidad (`/privacidad`) y términos (`/terminos`). Los textos actuales son **borradores**: revisarlos con asesoría legal (Ley 1581 de 2012; RGPD si entran usuarios de Europa).
- [ ] Verificar el dominio en Google Search Console.
- [ ] Configurar la pantalla de consentimiento OAuth y pedir la verificación de permisos sensibles.
- [ ] Grabar el video demo en inglés (flujo de conexión del canal y uso de cada permiso).
- [ ] Preparar el formulario de auditoría y ampliación de cuota, incluido el permiso de métricas derivadas.
- [ ] Abrir cuentas de API: Anthropic, Google AI (Gemini), Parallel y Resend (se usan desde la Fase 2).
- [ ] Definir la política de tratamiento de datos personales.

## Google Cloud: configuración técnica

**APIs a habilitar:** YouTube Data API v3 y YouTube Analytics API. (YouTube Reporting API se agrega en la Fase 4 para impresiones y CTR).

**Cliente OAuth (aplicación web):**

- Orígenes autorizados: `https://tu-dominio`
- URI de redirección: `https://tu-dominio/api/youtube/callback` (y `http://localhost:3000/api/youtube/callback` para desarrollo)

**Permisos que pide la app en la Fase 1 (solo lectura):**

| Permiso                 | Para qué                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `youtube.readonly`      | Leer el canal, sus subidas, estado de privacidad y fecha programada para avanzar episodios a Programado y Publicado |
| `yt-analytics.readonly` | Métricas del canal y de cada episodio (Fase 4)                                                                      |

Los permisos de escritura (`youtube.force-ssl` para responder comentarios, cambiar privacidad y subir la miniatura principal) se pedirán con autorización incremental en la Fase 4, cuando existan esas funciones; así la primera verificación es más simple.

**Inicio de sesión con Google (Supabase Auth):** es un cliente OAuth distinto o el mismo con la redirección de Supabase (`https://<proyecto>.supabase.co/auth/v1/callback`). Solo pide `email` y `profile`, que no son sensibles.

## Puente para la beta

Mientras llega la verificación, publicar la app en producción sin verificar: muestra advertencia pero no vence la conexión cada 7 días (en modo de prueba sí vence). Admite hasta 100 usuarios en toda su vida.

## Cuota

10.000 unidades diarias compartidas por todos los canales. Leer cuesta 1 unidad; responder un comentario, cambiar la privacidad o subir una miniatura cuestan 50. La sincronización de la app usa unas 3 unidades por canal y corrida, cada hora solo cuando hay algo por publicar cerca y cada 6 horas en canales quietos, y se detiene al llegar a 9.000 unidades en el día. Pedir ampliación con el formulario de auditoría antes de pasar de 20 canales. Prohibido repartir la carga en varios proyectos de Google.
