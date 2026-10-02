/**
 * A plain <img>. Evidence photos are shown byte for byte as pinned (the
 * same bytes the jury hashes), and previews come from blob: URLs, so the
 * Next.js image optimizer is deliberately not used here.
 */
export default function PlainImg({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
}
