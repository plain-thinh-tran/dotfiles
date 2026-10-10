import { useEffect, useState } from 'react';

const TYPE_MS = 30;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useTypewriter(text: string): { shown: string; typing: boolean } {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));
  useEffect(() => {
    if (count >= text.length) return;
    const timer = setTimeout(() => setCount(count + 1), TYPE_MS);
    return () => clearTimeout(timer);
  }, [count, text]);
  return { shown: text.slice(0, count), typing: count < text.length };
}
