import type { Metadata } from "next";
import { BRAND } from "@planificador/config";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Política de privacidad" };

// Borrador para revisar con asesoría legal antes de pedir la verificación de Google.
export default function PrivacyPage() {
  return (
    <Prose>
      <h1>Política de privacidad</h1>
      <p className="text-sm text-muted">Borrador · última actualización: 7 de octubre de 2026</p>

      <h2>Quiénes somos</h2>
      <p>
        {BRAND.name} es una herramienta para planificar, producir y publicar episodios de YouTube. Esta política explica
        qué datos tratamos, para qué y cómo puedes ejercer tus derechos conforme a la Ley 1581 de 2012 de Colombia y,
        cuando aplique, al Reglamento General de Protección de Datos (RGPD).
      </p>

      <h2>Datos que tratamos</h2>
      <ul>
        <li>Datos de cuenta: correo, nombre y foto de perfil de tu cuenta de Google o del correo con el que entras.</li>
        <li>Datos de trabajo: espacios, canales, episodios, ideas, checklists y la actividad de tu equipo.</li>
        <li>
          Datos de YouTube que autorizas: información de tu canal, títulos, descripciones, estado de privacidad,
          fechas y estadísticas de tus videos, mediante los Servicios de API de YouTube.
        </li>
      </ul>

      <h2>Uso de los Servicios de API de YouTube</h2>
      <p>
        {BRAND.name} usa los Servicios de API de YouTube. Al conectar tu canal aceptas los{" "}
        <a href="https://www.youtube.com/t/terms">Términos de Servicio de YouTube</a> y la{" "}
        <a href="https://policies.google.com/privacy">Política de Privacidad de Google</a>. Solo pedimos permisos de
        lectura y usamos los datos únicamente para mostrarte tu planificación y avanzar tus episodios a Programado y
        Publicado. No vendemos ni compartimos tus datos de YouTube con terceros, ni los usamos para publicidad.
      </p>
      <p>
        El uso y la transferencia de información recibida de las APIs de Google cumplen la{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Política de datos de usuario de los servicios de API de Google
        </a>
        , incluidos los requisitos de uso limitado.
      </p>

      <h2>Conservación</h2>
      <ul>
        <li>Títulos, descripciones y comentarios de YouTube se refrescan o se borran como máximo a los 30 días.</li>
        <li>Si desconectas un canal, revocamos el acceso con Google y borramos sus datos de YouTube en máximo 7 días.</li>
        <li>Los tokens de acceso se guardan cifrados y nunca se envían al navegador.</li>
      </ul>

      <h2>Revocar el acceso</h2>
      <p>
        Puedes desconectar tu canal desde la configuración del canal o revocar el acceso en cualquier momento desde la{" "}
        <a href="https://myaccount.google.com/connections">página de permisos de tu cuenta de Google</a>.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización, escribiendo a{" "}
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>
    </Prose>
  );
}
