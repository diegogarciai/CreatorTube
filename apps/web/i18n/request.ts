import { getRequestConfig } from "next-intl/server";

// Español por ahora; los textos ya viven en messages/ para traducir después.
export const DEFAULT_LOCALE = "es";

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "America/Bogota",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
