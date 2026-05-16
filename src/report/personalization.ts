import fs from "fs";
import path from "path";

export interface ReportPersonalization {
  title?: string;
  logoUrl?: string;
  fontUrl?: string;
  customCssPath?: string;
  excludeTabs?: string[];
  templatePath?: string;
}

export interface ResolvedPersonalization {
  title?: string;
  logoDataUri?: string;
  fontLinkHtml?: string;
  customCss?: string;
  excludedTabs: Set<string>;
}

const VALID_TABS = new Set(["delivery", "quality", "roles", "forecast", "advanced"]);

const LOGO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function resolvePersonalization(
  p: ReportPersonalization | undefined,
  boardDir: string,
): ResolvedPersonalization {
  if (!p) { return { excludedTabs: new Set() }; }

  let logoDataUri: string | undefined;
  if (p.logoUrl) {
    if (p.logoUrl.startsWith("data:")) {
      throw new Error(`[report] logoUrl ne peut pas commencer par "data:" — utiliser un chemin ou une URL http(s).`);
    }
    const isRemote = p.logoUrl.startsWith("http://") || p.logoUrl.startsWith("https://");
    if (isRemote) {
      logoDataUri = p.logoUrl;
    } else {
      const abs = path.resolve(boardDir, p.logoUrl);
      const ext = path.extname(abs).toLowerCase();
      const mime = LOGO_MIME[ext];
      if (!mime) {
        console.warn(`[report] Extension logo non reconnue : ${ext} — logo ignoré.`);
      } else if (!fs.existsSync(abs)) {
        throw new Error(`[report] logoUrl introuvable : ${abs}`);
      } else {
        logoDataUri = `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
      }
    }
  }

  let customCss: string | undefined;
  if (p.customCssPath) {
    const abs = path.resolve(boardDir, p.customCssPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`[report] customCssPath introuvable : ${abs}`);
    }
    customCss = fs.readFileSync(abs, "utf-8");
  }

  const fontLinkHtml = p.fontUrl
    ? `<link href="${p.fontUrl}" rel="stylesheet">`
    : undefined;

  const excludedTabs = new Set<string>();
  for (const t of p.excludeTabs ?? []) {
    if (VALID_TABS.has(t)) { excludedTabs.add(t); }
    else { console.warn(`[report] excludeTabs: onglet inconnu "${t}" ignoré.`); }
  }

  return { title: p.title, logoDataUri, fontLinkHtml, customCss, excludedTabs };
}
