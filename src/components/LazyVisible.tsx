import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders its children only once the placeholder scrolls into view. Used to
 * keep the heavy chart bundles off the dashboard's initial load — the list and
 * the KPI cards paint first, charts hydrate when the user reaches them.
 */
export function LazyVisible({
  children,
  minHeight = 260,
  rootMargin = "200px",
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  if (visible) return <>{children}</>;
  return (
    <div ref={ref} style={{ minHeight }} className="rounded-xl border border-border bg-card/50 animate-pulse" />
  );
}
