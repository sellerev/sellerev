"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const MIN_STAGE_MS = 400;
const TICK_MS = 50;
const EASE_FACTOR = 0.2; // current += (target - current) * EASE_FACTOR per tick

export type AnalyzeProgressStage =
  | "starting"
  | "fetching_page1"
  | "enriching_products"
  | "computing_metrics"
  | "finalizing"
  | "ready";

const STAGE_TARGETS: Record<AnalyzeProgressStage, number> = {
  starting: 5,
  fetching_page1: 15,
  enriching_products: 35,
  computing_metrics: 70,
  finalizing: 90,
  ready: 100,
};

function getMessageForPercent(pct: number): string {
  if (pct >= 95) return "Rendering results";
  if (pct >= 85) return "Finalizing snapshot & product cards";
  if (pct >= 70) return "Computing brand dominance & concentration";
  if (pct >= 55) return "Calculating market size & competition";
  if (pct >= 40) return "Enriching brands & categories";
  if (pct >= 25) return "Detecting sponsored vs organic placements";
  if (pct >= 10) return "Fetching Page 1 listings";
  return "Starting analysis";
}

function getBandKey(pct: number): number {
  if (pct >= 95) return 95;
  if (pct >= 85) return 85;
  if (pct >= 70) return 70;
  if (pct >= 55) return 55;
  if (pct >= 40) return 40;
  if (pct >= 25) return 25;
  if (pct >= 10) return 10;
  return 0;
}

export interface UseAnalyzeProgressReturn {
  percent: number;
  stageMessage: string;
  start: () => void;
  mark: (stage: AnalyzeProgressStage) => void;
  finish: () => Promise<void>;
}

export function useAnalyzeProgress(): UseAnalyzeProgressReturn {
  const [percent, setPercent] = useState(0);
  const [stageMessage, setStageMessage] = useState("Starting analysis");

  const targetPercentRef = useRef(0);
  const currentPercentRef = useRef(0);
  const lastStageChangeAtRef = useRef(0);
  const currentMessageBandRef = useRef(0);
  const finishResolveRef = useRef<(() => void) | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    cancelledRef.current = false;
    intervalRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      const target = targetPercentRef.current;
      let current = currentPercentRef.current;
      const next = Math.min(100, Math.max(current, current + (target - current) * EASE_FACTOR));
      currentPercentRef.current = next;
      setPercent(Math.round(next));

      const band = getBandKey(next);
      const now = Date.now();
      const elapsed = now - lastStageChangeAtRef.current;
      const jumpAhead = target - next > 20;
      if (band !== currentMessageBandRef.current && (elapsed >= MIN_STAGE_MS || jumpAhead)) {
        currentMessageBandRef.current = band;
        setStageMessage(getMessageForPercent(jumpAhead ? target : next));
        lastStageChangeAtRef.current = now;
      }

      // Resolve when close to 100% (easing asymptotically never hits exactly 100)
      if (next >= 99.5 && finishResolveRef.current) {
        currentPercentRef.current = 100;
        setPercent(100);
        stopLoop();
        finishResolveRef.current();
        finishResolveRef.current = null;
      }
    }, TICK_MS);
  }, [stopLoop]);

  const start = useCallback(() => {
    cancelledRef.current = true;
    stopLoop();
    finishResolveRef.current = null;
    targetPercentRef.current = STAGE_TARGETS.starting;
    currentPercentRef.current = 0;
    currentMessageBandRef.current = 0;
    lastStageChangeAtRef.current = Date.now();
    setPercent(0);
    setStageMessage("Starting analysis");
    cancelledRef.current = false;
    startLoop();
  }, [startLoop, stopLoop]);

  const mark = useCallback((stage: AnalyzeProgressStage) => {
    const target = STAGE_TARGETS[stage];
    targetPercentRef.current = Math.min(100, Math.max(targetPercentRef.current, target));
  }, []);

  const finish = useCallback((): Promise<void> => {
    targetPercentRef.current = 100;
    mark("ready");
    return new Promise<void>((resolve) => {
      finishResolveRef.current = resolve;
      if (currentPercentRef.current >= 100) {
        finishResolveRef.current = null;
        resolve();
      }
    });
  }, [mark]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopLoop();
    };
  }, [stopLoop]);

  return { percent, stageMessage, start, mark, finish };
}
