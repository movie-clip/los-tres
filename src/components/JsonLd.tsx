import { serializeJsonLd, type ProductJsonLd } from '@/server/catalogue/product-jsonld';

// The product JSON-LD as a script tag: server-rendered, no client JS, nothing
// visible. The serialiser escapes `<`, `>` and `&`, so the text cannot close
// the tag; this is the only place the JSON-LD text enters the HTML.
export function JsonLd({ data }: { data: ProductJsonLd }) {
  return (
    <script
      type="application/ld+json"
      data-testid="product-jsonld"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
