export function csrfHeaders(): Record<string, string> {
  const token = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('wa_csrf='))
    ?.slice('wa_csrf='.length);

  return token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {};
}
