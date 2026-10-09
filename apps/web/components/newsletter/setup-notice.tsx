import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Lo que falta configurar para poder enviar (clave, segmento, remitente). */
export async function NewsletterSetupNotice({
  channelId,
  missing,
}: {
  channelId: string;
  missing: string[];
}) {
  if (!missing.length) return null;
  const t = await getTranslations("newsletter");
  return (
    <p
      className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
      data-testid="newsletter-setup"
    >
      {t("setup", { items: missing.map((m) => t(`missing.${m}` as "missing.key")).join(", ") })}{" "}
      <Link href={`/c/${channelId}/ajustes`} className="underline">
        {t("setupLink")}
      </Link>
    </p>
  );
}
