import type { Metadata } from "next";
import { BRAND } from "@planificador/config";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Términos del servicio" };

// Borrador para revisar con asesoría legal.
export default function TermsPage() {
  return (
    <Prose>
      <h1>Términos del servicio</h1>
      <p className="text-sm text-muted">Borrador · última actualización: 7 de octubre de 2026</p>
      <h2>El servicio</h2>
      <p>
        {BRAND.name} se ofrece en beta cerrada por invitación. Puede cambiar, tener interrupciones y perder
        funcionalidades mientras se desarrolla.
      </p>
      <h2>Tu cuenta y tu equipo</h2>
      <p>
        Eres responsable de las personas que invitas a tu espacio y de los permisos que les das. El contenido que
        creas en {BRAND.name} es tuyo.
      </p>
      <h2>YouTube</h2>
      <p>
        Al conectar un canal aceptas los <a href="https://www.youtube.com/t/terms">Términos de Servicio de YouTube</a>.
        {BRAND.name} no está afiliado a YouTube ni a Google.
      </p>
      <h2>Contacto</h2>
      <p>
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
      </p>
    </Prose>
  );
}
