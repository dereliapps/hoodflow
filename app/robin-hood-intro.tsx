"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INTRO_SESSION_KEY = "hoodflow-robinhood-intro-v3";
const LETTERS = "hoodflow".split("");

const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;

type SceneGeometry = {
  launchX: number;
  launchY: number;
  arrowWidth: number;
  impactX: number;
  impactY: number;
  logoX: number;
  logoY: number;
  flightX: number;
  flightY: number;
  flightAngle: number;
};

function getSceneGeometry(width: number, height: number): SceneGeometry {
  if (width <= 720) {
    const arrowWidth = width * 0.24;
    const launchX = width * 0.264;
    const launchY = height * 0.42;
    const impactX = width * 0.84;
    const impactY = height * 0.445;
    const flightX = impactX - (launchX + arrowWidth * (216 / 220));
    const flightY = impactY - launchY;
    return {
      launchX,
      launchY,
      arrowWidth,
      impactX,
      impactY,
      logoX: width * 0.84,
      logoY: height * 0.535,
      flightX,
      flightY,
      flightAngle: Math.atan2(flightY, flightX) * (180 / Math.PI),
    };
  }

  const scale = Math.max(width / SCENE_WIDTH, height / SCENE_HEIGHT);
  const offsetX = (width - SCENE_WIDTH * scale) / 2;
  const offsetY = (height - SCENE_HEIGHT * scale) / 2;
  const mapX = (x: number) => offsetX + x * scale;
  const mapY = (y: number) => offsetY + y * scale;
  const arrowWidth = 223 * scale;
  const launchX = mapX(331);
  const launchY = mapY(395);
  const impactX = mapX(1405);
  const impactY = mapY(420);
  const flightX = impactX - (launchX + arrowWidth * (216 / 220));
  const flightY = impactY - launchY;

  return {
    launchX,
    launchY,
    arrowWidth,
    impactX,
    impactY,
    logoX: mapX(1442),
    logoY: mapY(505),
    flightX,
    flightY,
    flightAngle: Math.atan2(flightY, flightX) * (180 / Math.PI),
  };
}

function smoothstep(edgeA: number, edgeB: number, value: number) {
  const progress = Math.min(1, Math.max(0, (value - edgeA) / (edgeB - edgeA)));
  return progress * progress * (3 - 2 * progress);
}

type IntroStep = "idle" | "drawing" | "fired" | "hit" | "logo" | "open" | "leaving";

const STEP_ORDER: Record<IntroStep, number> = {
  idle: 0,
  drawing: 1,
  fired: 2,
  hit: 3,
  logo: 4,
  open: 5,
  leaving: 6,
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  targetX: number;
  targetY: number;
};

export default function RobinHoodIntro() {
  const [mounted, setMounted] = useState(true);
  const [step, setStep] = useState<IntroStep>("idle");
  const [charge, setCharge] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const firedRef = useRef(false);
  const drawStartedAtRef = useRef(0);
  const chargeFrameRef = useRef<number | null>(null);
  const particleFrameRef = useRef<number | null>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const previousOverflowRef = useRef("");
  const showIntroRef = useRef(false);

  const clearRuntime = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    if (chargeFrameRef.current !== null) cancelAnimationFrame(chargeFrameRef.current);
    if (particleFrameRef.current !== null) cancelAnimationFrame(particleFrameRef.current);
    chargeFrameRef.current = null;
    particleFrameRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const rememberVisit = useCallback(() => {
    if (process.env.NODE_ENV !== "production") return;
    try {
      window.sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    } catch {
      // The intro still works when storage is unavailable.
    }
  }, []);

  const finish = useCallback(() => {
    if (!showIntroRef.current) return;
    showIntroRef.current = false;
    rememberVisit();
    clearRuntime();
    document.body.style.overflow = previousOverflowRef.current;
    setMounted(false);
  }, [clearRuntime, rememberVisit]);

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const geometry = getSceneGeometry(rect.width, rect.height);
    const style = root.style;
    style.setProperty("--rh-launch-x", `${geometry.launchX}px`);
    style.setProperty("--rh-launch-y", `${geometry.launchY}px`);
    style.setProperty("--rh-arrow-width", `${geometry.arrowWidth}px`);
    style.setProperty("--rh-impact-x", `${geometry.impactX}px`);
    style.setProperty("--rh-impact-y", `${geometry.impactY}px`);
    style.setProperty("--rh-logo-x", `${geometry.logoX}px`);
    style.setProperty("--rh-logo-y", `${geometry.logoY}px`);
    style.setProperty("--rh-flight-x", `${geometry.flightX}px`);
    style.setProperty("--rh-flight-y", `${geometry.flightY}px`);
    style.setProperty("--rh-flight-x-18", `${geometry.flightX * 0.18}px`);
    style.setProperty("--rh-flight-y-18", `${geometry.flightY * 0.18 - 4}px`);
    style.setProperty("--rh-flight-x-62", `${geometry.flightX * 0.62}px`);
    style.setProperty("--rh-flight-y-62", `${geometry.flightY * 0.62 - 9}px`);
    style.setProperty("--rh-flight-x-86", `${geometry.flightX * 0.86}px`);
    style.setProperty("--rh-flight-y-86", `${geometry.flightY * 0.86 - 4}px`);
    style.setProperty("--rh-flight-angle", `${geometry.flightAngle}deg`);
  }, []);

  const burst = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !root || !context) return;
    const rect = root.getBoundingClientRect();
    const mobile = rect.width <= 720;
    const geometry = getSceneGeometry(rect.width, rect.height);
    const originX = geometry.impactX;
    const originY = geometry.impactY;
    const count = mobile ? 30 : 44;
    const sparks: Spark[] = Array.from({ length: count }, (_, index) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.8 + Math.random() * 6.2;
      const bar = index % 3;
      const barHeights = [28, 42, 56];
      const barHeight = barHeights[bar];
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        size: 0.8 + Math.random() * 2.1,
        color: index % 3 === 0 ? "#d8aa48" : "#37f08a",
        targetX: geometry.logoX + (bar - 1) * 14 + (Math.random() - 0.5) * 5,
        targetY: geometry.logoY + 27 - Math.random() * barHeight,
      };
    });
    const startedAt = performance.now();

    const paint = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, rect.width, rect.height);
      sparks.forEach((spark) => {
        if (elapsed < 190) {
          spark.x += spark.vx;
          spark.y += spark.vy;
          spark.vx *= 0.965;
          spark.vy = spark.vy * 0.965 + 0.14;
        } else {
          const pull = Math.min(0.28, 0.075 + (elapsed - 190) / 2400);
          spark.x += (spark.targetX - spark.x) * pull;
          spark.y += (spark.targetY - spark.y) * pull;
        }
        const alpha = elapsed > 540 ? Math.max(0, 1 - (elapsed - 540) / 230) : 1;
        context.globalAlpha = alpha;
        context.fillStyle = spark.color;
        context.shadowBlur = 10;
        context.shadowColor = spark.color;
        context.beginPath();
        context.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      if (elapsed < 780) particleFrameRef.current = requestAnimationFrame(paint);
      else context.clearRect(0, 0, rect.width, rect.height);
    };

    particleFrameRef.current = requestAnimationFrame(paint);
  }, []);

  const fire = useCallback(() => {
    if (!drawingRef.current || firedRef.current) return;
    drawingRef.current = false;
    firedRef.current = true;
    if (chargeFrameRef.current !== null) cancelAnimationFrame(chargeFrameRef.current);
    chargeFrameRef.current = null;
    setCharge(100);
    setStep("fired");
    schedule(() => {
      setStep("hit");
      burst();
    }, 430);
    schedule(() => setStep("logo"), 840);
    schedule(() => setStep("open"), 1450);
    schedule(() => {
      setStep("leaving");
      finish();
    }, 2600);
  }, [burst, finish, schedule]);

  const beginDraw = useCallback(() => {
    if (firedRef.current || drawingRef.current) return;
    drawingRef.current = true;
    drawStartedAtRef.current = performance.now();
    setStep("drawing");

    const update = (now: number) => {
      if (!drawingRef.current) return;
      const nextCharge = Math.min(100, (now - drawStartedAtRef.current) / 8.5);
      setCharge(nextCharge);
      chargeFrameRef.current = requestAnimationFrame(update);
    };
    chargeFrameRef.current = requestAnimationFrame(update);
  }, []);

  const cancelDraw = useCallback(() => {
    if (!drawingRef.current || firedRef.current) return;
    drawingRef.current = false;
    if (chargeFrameRef.current !== null) cancelAnimationFrame(chargeFrameRef.current);
    chargeFrameRef.current = null;
    setCharge(0);
    setStep("idle");
  }, []);

  const skip = useCallback(() => {
    if (!showIntroRef.current) return;
    setStep("leaving");
    rememberVisit();
    schedule(finish, 180);
  }, [finish, rememberVisit, schedule]);

  useEffect(() => {
    const forceReplay = new URLSearchParams(window.location.search).get("intro") === "1";
    let seen = false;
    if (process.env.NODE_ENV === "production" && !forceReplay) {
      try {
        seen = window.sessionStorage.getItem(INTRO_SESSION_KEY) === "1";
      } catch {
        seen = false;
      }
    }
    if (seen) {
      schedule(() => setMounted(false), 0);
      return;
    }

    showIntroRef.current = true;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sizeCanvas();
    resizeObserverRef.current = new ResizeObserver(sizeCanvas);
    if (rootRef.current) resizeObserverRef.current.observe(rootRef.current);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      schedule(() => {
        rootRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 180,
          easing: "ease-out",
          fill: "forwards",
        });
      }, 80);
      schedule(finish, 280);
    } else {
      schedule(() => triggerRef.current?.focus({ preventScroll: true }), 40);
    }

    return () => {
      clearRuntime();
      if (showIntroRef.current) document.body.style.overflow = previousOverflowRef.current;
      showIntroRef.current = false;
    };
  }, [clearRuntime, finish, schedule, sizeCanvas]);

  if (!mounted) return null;

  const rank = STEP_ORDER[step];
  const drawProgress = charge / 100;
  const readyOpacity = 1 - smoothstep(0.26, 0.48, drawProgress);
  const halfOpacity = smoothstep(0.26, 0.48, drawProgress) * (1 - smoothstep(0.72, 0.96, drawProgress));
  const introStyle = {
    "--rh-ready-opacity": readyOpacity,
    "--rh-half-opacity": halfOpacity,
    "--rh-actor-shift": `${drawProgress * -4}px`,
    "--rh-actor-tilt": `${drawProgress * -0.28}deg`,
  } as React.CSSProperties;
  const stageClass = [
    "rh-intro",
    step === "drawing" ? "is-drawing" : "",
    rank >= STEP_ORDER.fired ? "is-fired" : "",
    rank >= STEP_ORDER.hit ? "is-hit" : "",
    rank >= STEP_ORDER.logo ? "is-logo" : "",
    rank >= STEP_ORDER.open ? "is-open" : "",
    step === "leaving" ? "is-leaving" : "",
  ].filter(Boolean).join(" ");

  return (
    <section ref={rootRef} style={introStyle} className={stageClass} role="dialog" aria-modal="true" aria-labelledby="rh-intro-title">
      <div className="rh-intro-door rh-intro-door-left" aria-hidden="true">
        <div className="rh-intro-scene rh-intro-scene-base" />
        <div className="rh-intro-scene rh-intro-scene-half" />
        <div className="rh-intro-scene rh-intro-scene-ready" />
        <div className="rh-intro-scene rh-intro-scene-release" />
      </div>
      <div className="rh-intro-door rh-intro-door-right" aria-hidden="true">
        <div className="rh-intro-scene rh-intro-scene-base" />
        <div className="rh-intro-scene rh-intro-scene-bag" />
      </div>
      <div className="rh-intro-vignette" aria-hidden="true" />
      <div className="rh-intro-grain" aria-hidden="true" />

      <div className="rh-intro-topline" aria-hidden="true">
        <span className="rh-intro-brand"><i><b /><b /><b /></i>hoodflow</span>
        <span>ROBINHOOD CHAIN · MAINNET</span>
      </div>

      <h1 id="rh-intro-title" className="rh-intro-word" aria-label="HoodFlow">
        {LETTERS.map((letter, index) => <span key={`${letter}-${index}`} className="rh-intro-letter" style={{ "--letter-index": index } as React.CSSProperties}>{letter}</span>)}
      </h1>

      <div className="rh-intro-projectile" aria-hidden="true">
        <span className="rh-intro-arrow-trail" />
        <svg className="rh-intro-arrow" viewBox="0 0 220 30">
          <g className="rh-intro-arrow-body">
            <path className="rh-intro-arrow-shadow" d="M14 17H203" />
            <path className="rh-intro-arrow-shaft" d="M14 15H203" />
            <path className="rh-intro-arrow-nock" d="m14 10-8 5 8 5" />
            <path className="rh-intro-arrow-feather" d="m38 15-20-10-8 2 17 8Zm0 0-20 10-8-2 17-8Z" />
            <path className="rh-intro-arrow-binding" d="M31 9v12M35 11v8" />
            <path className="rh-intro-arrow-head" d="m216 15-29-9 12 9-12 9Z" />
          </g>
        </svg>
      </div>

      <div className="rh-intro-impact" aria-hidden="true"><i /><i /><i /></div>
      <canvas ref={canvasRef} className="rh-intro-particles" aria-hidden="true" />
      <div className="rh-intro-morph-logo" aria-hidden="true"><i /><i /><i /></div>

      <button
        ref={triggerRef}
        type="button"
        className="rh-intro-trigger"
        aria-label="Hold to draw the bow, then release to enter HoodFlow"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          beginDraw();
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          fire();
        }}
        onPointerCancel={cancelDraw}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            beginDraw();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            fire();
          }
        }}
      />

      <div className="rh-intro-controls" aria-live="polite">
        <p>{step === "drawing" ? (charge >= 100 ? "Bow locked — release" : `Drawing bow · ${Math.round(charge)}%`) : step === "idle" ? "Hold to draw. Release to enter." : "Arrow released"}</p>
        <div className="rh-intro-power"><i style={{ width: `${charge}%` }} /></div>
        <span>Hold anywhere · Space / Enter</span>
      </div>

      <button type="button" className="rh-intro-skip" onClick={skip}>Skip</button>
    </section>
  );
}
