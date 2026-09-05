"use client";

/**
 * The colour washes behind the page. The blue one follows the pointer with
 * a lag, so the ground shifts as you move; the green one drifts on its own.
 * On touch screens, or with reduced motion set, both simply drift.
 */

import { useEffect, useRef } from "react";

export function Wash() {
  const blue = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = blue.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    el.classList.add("follows");
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Centre the blob on the pointer, offset from where it rests.
        const x = e.clientX - window.innerWidth * 0.15;
        const y = e.clientY - window.innerHeight * 0.1;
        el.style.setProperty("--mx", `${x}px`);
        el.style.setProperty("--my", `${y}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="wash" aria-hidden>
      <span ref={blue} />
      <span />
    </div>
  );
}
