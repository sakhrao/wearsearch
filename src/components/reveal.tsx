"use client";

import { useEffect, useRef, type ReactNode } from "react";

/* Scroll-reveal wrapper. Uses a single IntersectionObserver per
   element, hones to a CSS class transition, disconnects after
   reveal, and is a no-op for prefers-reduced-motion clients
   (globals.css renders `.reveal` visible there). */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      element.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          element.classList.add("is-visible");
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}