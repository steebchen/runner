import mark from "../../public/suneiro-mark.svg?raw";

/** Trusted, local vector artwork; currentColor follows the app's theme. */
export function BrandMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`suneiro-mark inline-flex ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: mark.replace('width="64" height="64"', 'width="100%" height="100%"').replace(' color="#20374e"', '') }}
    />
  );
}
