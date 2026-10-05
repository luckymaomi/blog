/** Minimal HTML helpers — escape user text; assemble pages without += cobbling. */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Join non-empty fragments with a separator (default empty). */
export function joinHtml(parts, sep = '') {
  return parts.filter(Boolean).join(sep);
}

export function pageDocument({ title, body, cssHref, fontsHref }) {
  const t = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
  <link rel="stylesheet" href="${fontsHref}" />
  <link rel="stylesheet" href="${cssHref}" />
</head>
<body>
  <div class="wrap">
${body}
  </div>
</body>
</html>
`;
}
