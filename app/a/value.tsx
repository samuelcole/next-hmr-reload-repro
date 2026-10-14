"use client";

// Inlined at compile time. The repro gives it a different value each session.
export function Value() {
  return <p>NEXT_PUBLIC_VALUE: {process.env.NEXT_PUBLIC_VALUE}</p>;
}
