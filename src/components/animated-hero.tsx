"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import type { PointerEvent } from "react";

const spring = { stiffness: 95, damping: 22, mass: 0.7 };

export function AnimatedHero() {
  const reduceMotion = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, spring);
  const y = useSpring(rawY, spring);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (reduceMotion || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const xRatio = (event.clientX - bounds.left) / bounds.width - 0.5;
    const yRatio = (event.clientY - bounds.top) / bounds.height - 0.5;
    rawX.set(xRatio * -18);
    rawY.set(yRatio * -12);
  }

  function resetPosition() {
    rawX.set(0);
    rawY.set(0);
  }

  return (
    <section
      className="intro intro--image"
      id="top"
      aria-labelledby="page-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPosition}
    >
      <div className="hero-backdrop" aria-hidden="true">
        <motion.div
          className="hero-backdrop__photo"
          style={reduceMotion ? undefined : { x, y }}
        />
        <div className="hero-backdrop__duotone" />
        <div className="hero-backdrop__scan" />
      </div>

      <div className="intro__title">
        <p className="kicker">A pre-trade fair-value layer for tokenized stocks</p>
        <h1 id="page-title">Measure the gap before you trade it.</h1>
      </div>
      <div className="intro__context">
        <p className="intro__copy">
          xStocks trade on Solana around the clock. The US stock market does not. FairPrint keeps the token&apos;s last on-chain swap separate from the real stock reference, then shows the difference plainly.
        </p>
        <p className="hero-caption">São Paulo stays awake while Wall Street is closed.</p>
      </div>
    </section>
  );
}
