import type { BuildExtension } from "@trigger.dev/build";

/**
 * Chrome Headless Shell para Remotion en la imagen de Trigger.dev: las
 * librerías que pide Chrome en Debian y el navegador que Remotion prueba con
 * su versión (`TESTED_VERSION` de @remotion/renderer 4.0.534). Queda en
 * /opt/remotion-chrome/shell (REMOTION_CHROME_PATH). Si la descarga falla, la
 * tarea lo baja al arrancar con `ensureBrowser()`; el despliegue no se cae.
 */
const CHROME_VERSION = "157.0.8080.0";
const CHROME_URL = `https://remotion.media/chromium-headless-shell-linux-x64-${CHROME_VERSION}.zip?clear`;
const LIBS = [
  "ca-certificates",
  "curl",
  "unzip",
  "libnss3",
  "libdbus-1-3",
  "libatk1.0-0",
  "libgbm1",
  "libxrandr2",
  "libxkbcommon0",
  "libxfixes3",
  "libxcomposite1",
  "libxdamage1",
  "libatk-bridge2.0-0",
  "libpango-1.0-0",
  "libcairo2",
  "libcups2",
];

export function remotionChrome(): BuildExtension {
  return {
    name: "remotion-chrome",
    externalsForTarget: () => ["@remotion/renderer", "@remotion/compositor-linux-x64-gnu"],
    onBuildComplete(context) {
      if (context.target === "dev") return;
      context.addLayer({
        id: "remotion-chrome",
        image: {
          instructions: [
            `RUN apt-get update && apt-get install -y --no-install-recommends ${LIBS.join(" ")} && (apt-get install -y --no-install-recommends libasound2 || apt-get install -y --no-install-recommends libasound2t64 || true) && rm -rf /var/lib/apt/lists/*`,
            `RUN mkdir -p /opt/remotion-chrome && (curl -fsSL "${CHROME_URL}" -o /tmp/chrome.zip && unzip -q /tmp/chrome.zip -d /opt/remotion-chrome && rm -f /tmp/chrome.zip && ln -sf "$(find /opt/remotion-chrome -type f \\( -name headless_shell -o -name chrome-headless-shell \\) | head -1)" /opt/remotion-chrome/shell && chmod +x /opt/remotion-chrome/shell || echo "Sin Chrome en la imagen: se descarga al renderizar")`,
          ],
        },
        deploy: {
          env: { REMOTION_CHROME_PATH: "/opt/remotion-chrome/shell" },
          override: true,
        },
      });
    },
  };
}
