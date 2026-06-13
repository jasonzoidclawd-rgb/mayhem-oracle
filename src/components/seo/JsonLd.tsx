/**
 * Renders a schema.org JSON-LD block. Content must be trusted (build-time data
 * / curated strings) — `<` is escaped to prevent any `</script>` breakout.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
