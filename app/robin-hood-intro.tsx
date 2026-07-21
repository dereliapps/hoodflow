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
    const actorWidth = width;
    const actorScale = actorWidth / (SCENE_WIDTH / 4);
    const actorLeft = width * -0.22;
    const actorTop = height * 0.24;
    const arrowWidth = 198 * actorScale;
    const launchX = actorLeft + 140 * actorScale;
    const launchY = actorTop + 160 * actorScale;
    const impactX = width * 0.84;
    const impactY = height * 0.42;
    const flightX = impactX - (launchX + arrowWidth * (236 / 240));
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
  const actorWidth = (SCENE_WIDTH / 2) * 0.8 * scale;
  const actorScale = actorWidth / (SCENE_WIDTH / 4);
  const actorLeft = offsetX - 20 * scale;
  const actorTop = offsetY + 70 * scale;
  const arrowWidth = 198 * actorScale;
  const launchX = actorLeft + 140 * actorScale;
  const launchY = actorTop + 160 * actorScale;
  const impactX = mapX(1405);
  const impactY = mapY(420);
  const flightX = impactX - (launchX + arrowWidth * (236 / 240));
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
  const skipRef = useRef<HTMLButtonElement | null>(null);
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
  const shieldedSiblingsRef = useRef<Array<{ element: HTMLElement; inert: string | null; ariaHidden: string | null }>>([]);

  const restorePageAccess = useCallback(() => {
    shieldedSiblingsRef.current.forEach(({ element, inert, ariaHidden }) => {
      if (inert === null) element.removeAttribute("inert");
      else element.setAttribute("inert", inert);
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    });
    shieldedSiblingsRef.current = [];
  }, []);

  const clearRuntime = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    if (chargeFrameRef.current !== null) cancelAnimationFrame(chargeFrameRef.current);
    if (particleFrameRef.current !== null) cancelAnimationFrame(particleFrameRef.current);
    chargeFrameRef.current = null;
    particleFrameRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    restorePageAccess();
  }, [restorePageAccess]);

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
    const desktopSceneScale = Math.max(rect.width / SCENE_WIDTH, rect.height / SCENE_HEIGHT);
    const actorWidth = rect.width <= 720 ? rect.width : (SCENE_WIDTH / 2) * 0.8 * desktopSceneScale;
    const actorHeight = actorWidth * (SCENE_HEIGHT / (SCENE_WIDTH / 2));
    const actorLeft = rect.width <= 720 ? rect.width * -0.22 : (rect.width - SCENE_WIDTH * desktopSceneScale) / 2 - 20 * desktopSceneScale;
    const actorTop = rect.width <= 720 ? rect.height * 0.24 : (rect.height - SCENE_HEIGHT * desktopSceneScale) / 2 + 70 * desktopSceneScale;
    style.setProperty("--rh-actor-left", `${actorLeft}px`);
    style.setProperty("--rh-actor-top", `${actorTop}px`);
    style.setProperty("--rh-actor-width", `${actorWidth}px`);
    style.setProperty("--rh-actor-height", `${actorHeight}px`);
    style.setProperty("--rh-launch-x", `${geometry.launchX}px`);
    style.setProperty("--rh-launch-y", `${geometry.launchY}px`);
    style.setProperty("--rh-arrow-width", `${geometry.arrowWidth}px`);
    style.setProperty("--rh-impact-x", `${geometry.impactX}px`);
    style.setProperty("--rh-impact-y", `${geometry.impactY}px`);
    style.setProperty("--rh-logo-x", `${geometry.logoX}px`);
    style.setProperty("--rh-logo-y", `${geometry.logoY}px`);
    style.setProperty("--rh-flight-x", `${geometry.flightX}px`);
    style.setProperty("--rh-flight-y", `${geometry.flightY}px`);
    style.setProperty("--rh-flight-x-04", `${geometry.flightX * 0.04}px`);
    style.setProperty("--rh-flight-y-04", `${geometry.flightY * 0.04 - 1}px`);
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
    }, 390);
    schedule(() => setStep("logo"), 820);
    schedule(() => setStep("open"), 1510);
    schedule(() => setStep("leaving"), 2640);
    schedule(finish, 2850);
  }, [burst, finish, schedule]);

  const beginDraw = useCallback(() => {
    if (firedRef.current || drawingRef.current) return;
    drawingRef.current = true;
    drawStartedAtRef.current = performance.now();
    setStep("drawing");

    const update = (now: number) => {
      if (!drawingRef.current) return;
      const nextCharge = Math.min(100, (now - drawStartedAtRef.current) / 9.6);
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
    const introRoot = rootRef.current;
    const parent = introRoot?.parentElement;
    if (introRoot && parent) {
      shieldedSiblingsRef.current = Array.from(parent.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== introRoot)
        .map((element) => ({
          element,
          inert: element.getAttribute("inert"),
          ariaHidden: element.getAttribute("aria-hidden"),
        }));
      shieldedSiblingsRef.current.forEach(({ element }) => {
        element.setAttribute("inert", "");
        element.setAttribute("aria-hidden", "true");
      });
    }
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
  const drawFrame = step === "idle" ? 0 : Math.min(4, Math.floor(drawProgress * 5));
  const drawFrameColumn = drawFrame % 4;
  const drawFrameRow = Math.floor(drawFrame / 4);
  const introStyle = {
    "--rh-actor-frame-x": `${drawFrameColumn * (100 / 3)}%`,
    "--rh-actor-frame-y": `${drawFrameRow * 100}%`,
    "--rh-actor-shift-x": `${drawProgress * -7}px`,
    "--rh-actor-shift-y": `${Math.sin(drawProgress * Math.PI) * -2.5}px`,
    "--rh-actor-tilt": `${drawProgress * -0.48}deg`,
  } as React.CSSProperties;
  const stageClass = [
    "rh-intro",
    step === "drawing" ? "is-drawing" : "",
    rank >= STEP_ORDER.fired ? "is-fired" : "",
    rank >= STEP_ORDER.hit ? "is-hit" : "",
    rank >= STEP_ORDER.logo ? "is-logo" : "",
    rank >= STEP_ORDER.open ? "is-open" : "",
    step === "drawing" && charge >= 96 ? "is-locked" : "",
    step === "leaving" ? "is-leaving" : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      ref={rootRef}
      style={introStyle}
      className={stageClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rh-intro-title"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          skip();
          return;
        }
        if (event.key !== "Tab") return;
        const first = triggerRef.current;
        const last = skipRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="rh-intro-door rh-intro-door-left" aria-hidden="true">
        <div className="rh-intro-scene rh-intro-scene-base" />
      </div>
      <div className="rh-intro-door rh-intro-door-right" aria-hidden="true">
        <div className="rh-intro-scene rh-intro-scene-base" />
        <div className="rh-intro-scene rh-intro-scene-bag" />
      </div>
      <div className="rh-intro-actor-panel" aria-hidden="true">
        <div className="rh-intro-actor-sprite" />
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
        <svg className="rh-intro-arrow" viewBox="0 0 240 18">
          <g className="rh-intro-arrow-body">
            <path className="rh-intro-arrow-shadow" d="M9 10.2H228" />
            <path className="rh-intro-arrow-shaft" d="M9 9H228" />
            <path className="rh-intro-arrow-nock" d="m10 5-6 4 6 4" />
            <path className="rh-intro-arrow-feather" d="M35 8 15 3 9 5l16 4L9 13l6 2 20-5Z" />
            <path className="rh-intro-arrow-binding" d="M29 5.5v7M33 6.5v5" />
            <path className="rh-intro-arrow-head" d="m238 9-16-5 6 5-6 5Z" />
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

      <div className="rh-intro-controls" aria-hidden="true">
        <p>{step === "drawing" ? (charge >= 100 ? "Bow locked — release" : `Drawing bow · ${Math.round(charge)}%`) : step === "idle" ? "Hold to draw. Release to enter." : "Arrow released"}</p>
        <div className="rh-intro-power"><i style={{ width: `${charge}%` }} /></div>
        <span>Hold anywhere · Space / Enter</span>
      </div>

      <span className="rh-intro-status" aria-live="polite">
        {step === "idle" ? "Ready to draw" : step === "drawing" ? (charge >= 96 ? "Bow fully drawn. Release to enter." : "Drawing bow") : "Arrow released"}
      </span>

      <button ref={skipRef} type="button" className="rh-intro-skip" onClick={skip}>Skip</button>
    </section>
  );
}
