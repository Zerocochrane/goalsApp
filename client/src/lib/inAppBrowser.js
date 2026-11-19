// Detecta navegadores internos de apps (WhatsApp, Instagram, Facebook…). Eles não
// compartilham cookies com o Chrome/Safari, então o login pode não persistir.
// Não pega todos os casos (o SFSafariViewController do iOS parece o Safari), por isso
// a dica também aparece no celular quando o login veio de um link de validação.

const IN_APP_UA = /WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line\/|; wv\)/i;

/** `true` se o user agent indica o navegador interno de um app. */
export function isInAppBrowser(userAgent = globalThis.navigator?.userAgent ?? '') {
  if (IN_APP_UA.test(userAgent)) return true;
  // WKWebView do iOS: iPhone/iPad sem o token "Safari"
  return /iPhone|iPad|iPod/.test(userAgent) && !/Safari\//.test(userAgent);
}
