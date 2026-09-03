import { useCallback, useEffect, useRef, useState } from 'react';

import { simulate } from '@shared/sim.ts';
import { buildScore, isMusicGenre, musicGenreForSeed } from '@shared/audio/score.ts';
import { ARCHETYPES, ARCHETYPE_NAMES } from '@shared/generator.ts';
import { PALETTE_NAMES } from '@shared/palette.ts';
import type { CreateRaceRequest } from '@shared/api.ts';

import {
  AudioDirector,
  loadSettings,
  saveSettings,
  type AudioSettings,
} from './audio/director.ts';
import { hasAudioEncoder } from './audio/render.ts';
import { RaceScene, type SceneSnapshot } from './scene/RaceScene.ts';
import { probeCapability, estimateSeconds, type Capability } from './export/capabilities.ts';
import { exportRace, downloadBlob, ExportAborted, type ExportProgress, type ExportResult } from './export/exportRace.ts';
import { qualityById } from './export/quality.ts';
import { presetById, DEFAULT_PRESET_ID, type PresetId } from './render/presets.ts';
import { planForBudget, budgetById, framesFor, DEFAULT_BUDGET_ID } from './render/budget.ts';
import { createRace, fetchRace, requestRender, track, type RaceResult } from './lib/api.ts';
import { detectLang, makeTranslate, type Lang } from './i18n.ts';

import { SafeFrame } from './ui/SafeFrame.tsx';
import { Wordmark } from './ui/Wordmark.tsx';
import { TimingTower } from './ui/TimingTower.tsx';
import { StartLights } from './ui/StartLights.tsx';
import { SeedPlate } from './ui/SeedPlate.tsx';
import { ResultsCard } from './ui/ResultsCard.tsx';
import { AudioPanel } from './ui/AudioPanel.tsx';
import { ExportPanel, type ExportPhase } from './ui/ExportPanel.tsx';
import {
  RaceSetupPanel,
  type MusicChoice,
  type RaceSetupSelection,
} from './ui/RaceSetupPanel.tsx';

type Status = 'booting' | 'creating' | 'measuring' | 'ready' | 'error';
type Panel = 'none' | 'results' | 'export' | 'setup';

/**
 * Ignore viewport changes smaller than this, in pixels.
 *
 * iOS Safari fires `resize` every time the URL bar slides in or out, which is
 * constantly, and each one used to reallocate the whole drawing buffer — a
 * buffer we keep two of, because `preserveDrawingBuffer` is on for the exporter.
 * The bar is about 60 px, so anything under this is chrome moving, not the
 * window changing.
 */
const RESIZE_EPSILON = 80;
/** Settle time before acting on a resize. One frame is not enough on a phone. */
const RESIZE_DEBOUNCE_MS = 220;
const AUTO_NEXT_DELAY_MS = 6000;
const AUTO_NEXT_STORAGE_KEY = 'canicarrera.autoNext';

function allowedValue<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && allowed.some((candidate) => candidate === value)
    ? (value as T)
    : undefined;
}

/** Auto-next is the broadcast default, but the viewer's choice is sticky. */
function loadAutoNext(): boolean {
  try {
    const saved = localStorage.getItem(AUTO_NEXT_STORAGE_KEY);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function saveAutoNext(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable in private browsing. The current session still
    // works; only persistence is lost.
  }
}

export function App(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RaceScene | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultBlobRef = useRef<ExportResult | null>(null);
  const bootedRef = useRef(false);
  /** What we promised on the button, kept so telemetry can compare it to reality. */
  const exportPredictionRef = useRef<number | null>(null);

  const [lang, setLang] = useState<Lang>(detectLang);
  const [status, setStatus] = useState<Status>('booting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [race, setRace] = useState<RaceResult | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const exportPanelOpen = panel === 'export';
  const [copied, setCopied] = useState(false);
  /** True while the GPU has taken the drawing context away. */
  const [contextLost, setContextLost] = useState(false);
  /**
   * A distraction-free race view. On browsers with the Fullscreen API this is
   * also native fullscreen; on iPhone it remains a useful chrome-free in-app
   * view instead of making the feature disappear entirely.
   */
  const [immersive, setImmersive] = useState(false);
  const nativeFullscreenRef = useRef(false);
  const [autoNext, setAutoNext] = useState(loadAutoNext);
  const [autoNextRemaining, setAutoNextRemaining] = useState<number | null>(null);
  /** A user action cancels auto-next for this finish, not for all future races. */
  const autoNextSuppressedRaceRef = useRef<string | null>(null);

  // Audio ships OFF and remembered. Two reasons, and both are about respect:
  // browsers refuse to make noise before a gesture anyway, and a page that
  // starts playing drum and bass at someone in an open-plan office is a page
  // they close.
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadSettings);
  const audioSettingsRef = useRef(audioSettings);
  const [exportAudio, setExportAudio] = useState(true);
  const audioRef = useRef<AudioDirector | null>(null);
  if (!audioRef.current) audioRef.current = new AudioDirector(audioSettings);

  const [exportPhase, setExportPhase] = useState<ExportPhase>('choose');
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Two independent quality axes plus the budget that drives them.
  //
  // `auto` is the important one: while it holds, the plan is recomputed from
  // the measurement, so a user who never opens the advanced panel always gets
  // the best their machine can do inside the wait they chose. Touching either
  // axis by hand clears it, and nothing silently overrides them after that.
  const [qualityId, setQualityId] = useState('1080p30');
  const [presetId, setPresetId] = useState<PresetId>(DEFAULT_PRESET_ID);
  const [budgetId, setBudgetId] = useState(DEFAULT_BUDGET_ID);
  const [auto, setAuto] = useState(true);

  const t = makeTranslate(lang);

  // -------------------------------------------------------------- boot

  useEffect(() => {
    // Deliberately not inside StrictMode: creating and disposing a WebGL
    // context twice on mount is expensive and would fire two race requests.
    if (bootedRef.current) return;
    bootedRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: RaceScene;
    try {
      scene = new RaceScene(canvas);
    } catch {
      setStatus('error');
      setFatal(t('error.noWebgl'));
      return;
    }
    sceneRef.current = scene;
    scene.setSize(window.innerWidth, window.innerHeight);
    // Debug handle. Cheap, and the alternative when something goes wrong in the
    // render loop is rebuilding the bundle just to look at a number.
    (window as unknown as Record<string, unknown>).__canicarrera = scene;

    scene.onSnapshot = (next) => {
      setSnapshot(next);
      document.documentElement.style.setProperty('--leader', next.leaderColor);
    };

    // A lost context used to be a permanently frozen canvas with a HUD still
    // ticking over it — which is exactly what "it got stuck" describes. Now it
    // says so, and the scene rebuilds itself from the spec when the browser
    // hands the context back.
    scene.onContextChange = (state) => {
      setContextLost(state === 'lost');
      if (state === 'lost') {
        audioRef.current?.stop();
        track('context_lost', {});
      } else {
        scene.restart();
        scene.start();
      }
    };

    // Debounced, and deaf to the URL bar. See RESIZE_EPSILON.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    const onResize = (): void => {
      if (exportInFlight.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      // A width change is a real change — a rotation, a window drag. A height
      // change on its own, under the threshold, is browser chrome sliding.
      if (width === lastWidth && Math.abs(height - lastHeight) < RESIZE_EPSILON) return;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        lastWidth = window.innerWidth;
        lastHeight = window.innerHeight;
        if (exportInFlight.current) return;
        scene.setSize(lastWidth, lastHeight);
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);

    void boot();

    return () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      audioRef.current?.dispose();
      audioRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportInFlight = useRef(false);

  // Leaving native fullscreen via Escape or the browser's own gesture must put
  // our HUD back too. The ref distinguishes that event from the iPhone fallback,
  // which deliberately has no native fullscreen element.
  useEffect(() => {
    const onFullscreenChange = (): void => {
      if (document.fullscreenElement) {
        nativeFullscreenRef.current = true;
        setImmersive(true);
      } else if (nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        setImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const loadRace = useCallback(
    async (result: RaceResult, options: { probe?: boolean } = {}): Promise<void> => {
      const scene = sceneRef.current;
      if (!scene) return;

      setRace(result);
      setPanel('none');
      setExportPhase('choose');
      setExportResult(null);
      setExportError(null);
      resultBlobRef.current = null;

      // One simulation, three consumers: the frame count, the soundtrack and
      // the export's own length check. `trace` collects the contact events and
      // the tension curve the score is arranged against.
      const summary = simulate(result.spec, undefined, { trace: true });
      setVideoDuration(summary.videoDuration);
      audioRef.current?.load(
        buildScore(result.spec, summary, { genre: audioSettingsRef.current.genre }),
      );

      scene.load(result.spec);

      // Measure before the lights, not during them: a benchmark that stutters
      // the countdown is worse than one second of an honest "measuring" label.
      if (options.probe) {
        setStatus('measuring');
        const measured = await probeCapability(scene);
        setCapability(measured);
        track('capability_probe', {
          tier: measured.tier,
          codec: measured.codec,
          hardware: measured.hardwareAccelerated,
          rasterFps: measured.benchmark?.rasterFps ?? null,
          pipelineFps: measured.benchmark?.pipelineFps ?? null,
          postFX: measured.postFX,
        });
      }

      scene.restart();
      scene.start();
      // From zero, matching the scene: the score's clock and the sim's clock are
      // the same clock, and `restart()` has just put the sim back on the grid.
      audioRef.current?.start(0);
      setStatus('ready');

      const url = new URL(window.location.href);
      url.searchParams.set('c', result.spec.seed);
      url.searchParams.set('world', result.spec.palette);
      url.searchParams.set('track', result.spec.archetype);
      url.searchParams.set('music', audioSettingsRef.current.genre);
      url.searchParams.delete('r');
      window.history.replaceState(null, '', url);
    },
    [],
  );

  /**
   * Finish -> pre-generate -> six visible seconds -> load.
   *
   * The timer deliberately counts only while the document is visible, matching
   * RaceScene's playback policy. Its cleanup makes the prefetched result stale
   * if replay, export or a manual race wins the interaction instead.
   */
  useEffect(() => {
    const raceId = race?.id;
    if (
      !autoNext ||
      !raceId ||
      snapshot?.phase !== 'finished' ||
      exportPanelOpen ||
      autoNextSuppressedRaceRef.current === raceId
    ) {
      setAutoNextRemaining(null);
      return;
    }

    let cancelled = false;
    let remainingMs = AUTO_NEXT_DELAY_MS;
    let lastTick = performance.now();
    // Handle failure immediately so a rejected prefetch cannot sit unobserved
    // for six seconds and become a browser-level `unhandledrejection`.
    const prefetched = createRace().then(
      (next) => next,
      () => null,
    );
    setAutoNextRemaining(Math.ceil(remainingMs / 1000));

    const launch = async (): Promise<void> => {
      window.clearInterval(timer);
      setAutoNextRemaining(null);
      try {
        const next = await prefetched;
        if (!next || cancelled || autoNextSuppressedRaceRef.current === raceId) return;
        setStatus('creating');
        setSnapshot(null);
        await loadRace(next);
      } catch {
        // `createRace` already attempts a local fallback. If both routes fail,
        // keep the completed race and its results available instead of leaving
        // an endless loading overlay.
        if (!cancelled) setStatus('ready');
      }
    };

    const tick = (): void => {
      const now = performance.now();
      if (document.hidden) {
        lastTick = now;
        return;
      }
      remainingMs -= now - lastTick;
      lastTick = now;
      if (remainingMs <= 0) {
        void launch();
        return;
      }
      setAutoNextRemaining(Math.ceil(remainingMs / 1000));
    };

    const onVisibilityChange = (): void => {
      const now = performance.now();
      // Capture the last visible fraction before pausing. On return, resetting
      // `lastTick` prevents the hidden duration from being subtracted at once.
      if (document.hidden) remainingMs -= now - lastTick;
      lastTick = now;
    };

    const timer = window.setInterval(tick, 200);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoNext, exportPanelOpen, loadRace, race?.id, snapshot?.phase]);

  async function boot(): Promise<void> {
    setStatus('creating');
    const params = new URLSearchParams(window.location.search);
    const raceId = params.get('r');
    const seed = params.get('c');
    const palette = allowedValue(params.get('world'), PALETTE_NAMES);
    const archetype = allowedValue(params.get('track'), ARCHETYPE_NAMES);
    const requestedGenre = params.get('music');

    if (isMusicGenre(requestedGenre)) {
      const nextSettings = { ...audioSettingsRef.current, genre: requestedGenre };
      audioSettingsRef.current = nextSettings;
      setAudioSettings(nextSettings);
      saveSettings(nextSettings);
      audioRef.current?.setSettings(nextSettings);
    }

    try {
      let result: RaceResult | null = null;
      if (raceId) result = await fetchRace(raceId);
      if (!result) result = await createRace({ seed: seed || undefined, palette, archetype });
      await loadRace(result, { probe: true });
    } catch (error) {
      // Without this the busy overlay stays up forever and the page reads as
      // hung — the same symptom as a lost context, from a different cause.
      // `createRace` already falls back to local curation, so reaching here
      // means the scene itself failed to build.
      setStatus('error');
      setFatal(error instanceof Error ? error.message : t('error.race'));
    }
  }

  // Show the podium a beat after the finish, so the confetti lands first.
  useEffect(() => {
    if (
      snapshot?.phase !== 'finished' ||
      panel !== 'none' ||
      immersive ||
      exportInFlight.current
    ) return;
    const timer = setTimeout(() => {
      setPanel('results');
      if (race) {
        track(
          'race_watched',
          { duration: race.metrics.duration, archetype: race.spec.archetype },
          race.id,
          race.spec.seed,
        );
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [snapshot?.phase, panel, race, immersive]);

  // -------------------------------------------------------------- quality plan

  // While `auto` holds, the plan is derived rather than stored: measurement
  // plus chosen budget in, resolution plus preset out. It recomputes when any
  // input changes — including on a new race, because a 40-second race can
  // afford a richer preset than a 90-second one on the very same machine.
  useEffect(() => {
    if (!auto || !capability || videoDuration <= 0) return;
    const plan = planForBudget(capability, videoDuration, budgetById(budgetId).seconds);
    setQualityId(plan.qualityId);
    setPresetId(plan.presetId);
  }, [auto, capability, videoDuration, budgetId]);

  // The preview is meant to show what the export will look like, so bloom,
  // reflections and materials all apply to live playback. Only supersampling
  // and motion blur are held back for the offline path, where a frame is
  // allowed to cost ten times what a realtime frame can.
  useEffect(() => {
    sceneRef.current?.setRenderPreset(presetById(presetId));
  }, [presetId]);

  const chooseQuality = useCallback((id: string): void => {
    setAuto(false);
    setQualityId(id);
  }, []);

  const choosePreset = useCallback((id: PresetId): void => {
    setAuto(false);
    setPresetId(id);
  }, []);

  const chooseBudget = useCallback((id: string): void => {
    // Picking a budget is how you ask for the automatic plan back.
    setAuto(true);
    setBudgetId(id);
  }, []);

  // -------------------------------------------------------------- actions

  const newRace = useCallback(
    async (
      request: CreateRaceRequest = {},
      options: { music?: MusicChoice } = {},
    ): Promise<void> => {
      if (race) autoNextSuppressedRaceRef.current = race.id;
      setAutoNextRemaining(null);
      setStatus('creating');
      setSnapshot(null);
      try {
        const result = await createRace(request);
        if (options.music) {
          const genre = options.music === 'random'
            ? musicGenreForSeed(result.spec.seed)
            : options.music;
          const nextSettings = { ...audioSettingsRef.current, genre };
          audioSettingsRef.current = nextSettings;
          setAudioSettings(nextSettings);
          saveSettings(nextSettings);
          audioRef.current?.setSettings(nextSettings);
        }
        await loadRace(result);
      } catch {
        // Same reasoning as `boot`: never leave the busy overlay up.
        setStatus('ready');
      }
    },
    [loadRace, race],
  );

  const replay = useCallback((): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (race) autoNextSuppressedRaceRef.current = race.id;
    setAutoNextRemaining(null);
    setPanel('none');
    scene.restart();
    setSnapshot(scene.snapshot());
    scene.start();
    audioRef.current?.start(0);
  }, [race]);

  const skipToEnd = useCallback((): void => {
    const sim = sceneRef.current?.sim;
    if (!sim) return;
    // The music is a fixed arrangement anchored to video time, so there is
    // nothing sensible to fast-forward it to — stop rather than let it play on
    // under a podium it has not reached yet.
    audioRef.current?.stop();
    let guard = 40000;
    while (sim.phase !== 'finished' && guard-- > 0) sim.step();
  }, []);

  /**
   * Turning sound on is the gesture that creates the `AudioContext`.
   *
   * It has to happen inside the click handler — a context created outside a
   * gesture starts suspended and, on Safari, stays that way. That single
   * constraint is why audio is a button rather than a setting applied at boot.
   */
  const changeAudio = useCallback(
    (next: AudioSettings): void => {
      const wasOff = !audioSettings.enabled;
      const genreChanged = next.genre !== audioSettings.genre;
      audioSettingsRef.current = next;
      setAudioSettings(next);
      saveSettings(next);
      const director = audioRef.current;
      if (!director) return;

      if (genreChanged && race) {
        const summary = simulate(race.spec, undefined, { trace: true });
        director.load(buildScore(race.spec, summary, { genre: next.genre }));
        const url = new URL(window.location.href);
        url.searchParams.set('music', next.genre);
        window.history.replaceState(null, '', url);
      }

      if (next.enabled) {
        void director.unlock().then((ready) => {
          director.setSettings(next);
          // Join the race already in progress rather than starting the score
          // from the top: the sim's clock is the score's clock.
          const sim = sceneRef.current?.sim;
          if (ready && (wasOff || genreChanged) && sim && sim.phase !== 'finished') {
            director.start(sim.time);
          }
        });
      } else {
        director.setSettings(next);
      }
    },
    [audioSettings.enabled, audioSettings.genre, race],
  );

  const openNewRace = useCallback((): void => {
    if (race) autoNextSuppressedRaceRef.current = race.id;
    setAutoNextRemaining(null);
    if (autoNext) {
      void newRace();
    } else {
      setPanel('setup');
    }
  }, [autoNext, newRace, race]);

  const startConfiguredRace = useCallback(
    (selection: RaceSetupSelection): void => {
      void newRace(
        { palette: selection.palette, archetype: selection.archetype },
        { music: selection.music },
      );
    },
    [newRace],
  );

  const copyLink = useCallback((): void => {
    if (!race) return;
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('c', race.spec.seed);
    url.searchParams.set('world', race.spec.palette);
    url.searchParams.set('track', race.spec.archetype);
    url.searchParams.set('music', audioSettingsRef.current.genre);
    void navigator.clipboard?.writeText(url.toString()).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      },
      () => undefined,
    );
  }, [race]);

  const startExport = useCallback(async (): Promise<void> => {
    const scene = sceneRef.current;
    if (!scene || !race) return;

    autoNextSuppressedRaceRef.current = race.id;
    setAutoNextRemaining(null);

    const quality = qualityById(qualityId);
    const preset = presetById(presetId);
    const controller = new AbortController();
    abortRef.current = controller;
    exportInFlight.current = true;

    setPanel('export');
    setExportPhase('running');
    setExportError(null);
    setExportProgress(null);
    // The preview and the file are separate decisions. Someone watching in
    // silence at a desk still wants sound in the video they are about to upload,
    // so this reads the export toggle, not the live one.
    audioRef.current?.stop();

    exportPredictionRef.current = capability
      ? estimateSeconds(capability, quality, preset, framesFor(quality, videoDuration))
      : null;

    // Tell the server a render is happening. Stage 0 always gets
    // `mode: "client"` back; the call exists so the protocol is already in
    // place the day a server renderer does.
    void requestRender(race.id, {
      width: quality.width,
      height: quality.height,
      fps: quality.fps,
    });

    try {
      const result = await exportRace({
        scene,
        spec: race.spec,
        quality,
        preset,
        audio: exportAudio ? audioSettings : null,
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      resultBlobRef.current = result;
      setExportResult(result);
      setExportPhase('done');
      downloadBlob(result.blob, `canicarrera-${race.spec.seed}-${quality.id}-${preset.id}.mp4`);
      track(
        'export_finished',
        {
          quality: quality.id,
          preset: preset.id,
          auto,
          budget: budgetId,
          frames: result.frames,
          seconds: result.elapsedMs / 1000,
          fps: result.fps,
          bytes: result.blob.size,
          // Asked for vs actually got: the pair that will tell us how many
          // browsers in the wild have `VideoEncoder` but not `AudioEncoder`.
          audioWanted: exportAudio,
          audio: result.hasAudio,
          genre: audioSettings.genre,
          // The promise on the button, alongside what actually happened. This
          // pair is the only way to find out whether the cost model is honest
          // on hardware we do not own.
          predicted: exportPredictionRef.current,
        },
        race.id,
        race.spec.seed,
      );
    } catch (error) {
      if (error instanceof ExportAborted) {
        setExportPhase('choose');
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        setExportError(t('error.export', { detail }));
        setExportPhase('error');
        track(
          'export_failed',
          { quality: quality.id, preset: preset.id, detail },
          race.id,
          race.spec.seed,
        );
      }
    } finally {
      exportInFlight.current = false;
      abortRef.current = null;
    }
  }, [
    race,
    qualityId,
    presetId,
    auto,
    budgetId,
    capability,
    videoDuration,
    lang,
    exportAudio,
    audioSettings,
  ]);

  // Measure lazily if the first attempt could not.
  //
  // The probe refuses to run in a hidden tab (the number would be wrong and we
  // would cache it for a month), so anyone who opened this link in a background
  // tab arrives with no measurement. The export panel is exactly where the
  // number is needed and the race is already over, so take it then.
  useEffect(() => {
    if (panel !== 'export') return;
    if (!capability?.webCodecs || capability.benchmark) return;
    if (document.hidden || exportPhase !== 'choose') return;
    void remeasureRef.current?.();
  }, [panel, capability, exportPhase]);

  const remeasureRef = useRef<(() => Promise<void>) | null>(null);

  const remeasure = useCallback(async (): Promise<void> => {
    const scene = sceneRef.current;
    if (!scene) return;
    const wasRunning = scene.isRunning;
    scene.stop();
    setStatus('measuring');
    const measured = await probeCapability(scene, { force: true });
    setCapability(measured);
    // No need to touch the selection: if `auto` is on, the plan effect will
    // recompute it from this new measurement; if it is off, the user chose
    // these settings deliberately and a re-measurement is not permission to
    // change them.
    setStatus('ready');
    if (wasRunning) scene.start();
  }, []);

  remeasureRef.current = remeasure;

  const toggleLang = useCallback((): void => {
    setLang((current) => {
      const next: Lang = current === 'es' ? 'en' : 'es';
      localStorage.setItem('canicarrera.lang', next);
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback((): void => {
    if (immersive) {
      setImmersive(false);
      nativeFullscreenRef.current = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }

    // A results/export card is not part of the race view. Close it first, but
    // leave the race itself exactly where it is.
    setPanel('none');
    setImmersive(true);

    const root = document.documentElement;
    if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return;
    nativeFullscreenRef.current = true;
    void root.requestFullscreen().catch(() => {
      // Permission can be denied (embedded page, browser policy, iPhone). The
      // in-app immersive view remains active and is the intentional fallback.
      nativeFullscreenRef.current = false;
    });
  }, [immersive]);

  const toggleAutoNext = useCallback((): void => {
    setAutoNext((current) => {
      const next = !current;
      saveAutoNext(next);
      if (next) {
        // Re-enabling at the podium is an explicit request to resume the timer
        // for this race, even if another interaction had cancelled it earlier.
        autoNextSuppressedRaceRef.current = null;
      } else if (race) {
        autoNextSuppressedRaceRef.current = race.id;
        setAutoNextRemaining(null);
      }
      return next;
    });
  }, [race]);

  // -------------------------------------------------------------- render

  const busy = status === 'creating' || status === 'measuring';
  const archetypeLabel = race ? ARCHETYPES[race.spec.archetype].label : null;

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />
      {!immersive && <SafeFrame />}

      {status === 'error' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
          <div className="slab max-w-sm px-5 py-5">
            <h2 className="u-narrow text-[20px] font-bold uppercase">{t('error.title')}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-(--color-dim)">{fatal}</p>
          </div>
        </div>
      )}

      {status !== 'error' && (
        <>
          {!immersive && (
            <div
              className="pointer-events-auto fixed z-10"
              style={{ top: 'calc(var(--safe) + 14px)', left: 'calc(var(--safe) + 14px)' }}
            >
              <Wordmark
                snapshot={snapshot}
                archetype={archetypeLabel}
                t={t}
                lang={lang}
                onToggleLang={toggleLang}
              />
            </div>
          )}

          {snapshot && !immersive && (
            <div
              className="fixed z-10 flex flex-col items-end gap-2"
              style={{ top: 'calc(var(--safe) + 14px)', right: 'calc(var(--safe) + 14px)' }}
            >
              <TimingTower snapshot={snapshot} t={t} />
              <AudioPanel settings={audioSettings} onChange={changeAudio} t={t} />
            </div>
          )}

          {contextLost && (
            <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center p-6">
              <div className="slab max-w-sm px-5 py-5 text-center">
                <h2 className="u-narrow text-[18px] font-bold uppercase">{t('error.title')}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-(--color-dim)">
                  {t('error.contextLost')}
                </p>
                <button
                  type="button"
                  className="btn mt-4 w-full"
                  onClick={() => window.location.reload()}
                >
                  {t('error.contextLostAction')}
                </button>
              </div>
            </div>
          )}

          {snapshot && (
            <StartLights
              countdownLeft={snapshot.countdownLeft}
              racing={snapshot.phase === 'racing'}
              raceTime={snapshot.raceTime}
              t={t}
            />
          )}

          {panel !== 'none' && !immersive && (
            <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center p-4">
              <div className="pointer-events-auto">
                {panel === 'results' && race && snapshot && (
                  <ResultsCard
                    standings={snapshot.standings}
                    metrics={race.metrics}
                    t={t}
                    busy={busy}
                    onExport={() => {
                      // Opening the export workflow is already a decision to
                      // keep this result; do not replace it while the viewer is
                      // still choosing quality settings.
                      autoNextSuppressedRaceRef.current = race.id;
                      setAutoNextRemaining(null);
                      setExportPhase('choose');
                      setPanel('export');
                    }}
                    onNewRace={openNewRace}
                    onReplay={replay}
                    autoNext={autoNext}
                    autoNextRemaining={autoNextRemaining}
                    onToggleAutoNext={toggleAutoNext}
                  />
                )}
                {panel === 'setup' && (
                  <RaceSetupPanel
                    currentGenre={audioSettings.genre}
                    onStart={startConfiguredRace}
                    onClose={() => setPanel(snapshot?.phase === 'finished' ? 'results' : 'none')}
                    t={t}
                  />
                )}
                {panel === 'export' && (
                  <ExportPanel
                    phase={exportPhase}
                    capability={capability}
                    videoDuration={videoDuration}
                    qualityId={qualityId}
                    presetId={presetId}
                    budgetId={budgetId}
                    auto={auto}
                    audio={exportAudio}
                    audioAvailable={hasAudioEncoder()}
                    onToggleAudio={setExportAudio}
                    onSelectQuality={chooseQuality}
                    onSelectPreset={choosePreset}
                    onSelectBudget={chooseBudget}
                    onResetAuto={() => setAuto(true)}
                    progress={exportProgress}
                    result={exportResult}
                    error={exportError}
                    onStart={() => void startExport()}
                    onCancel={() => abortRef.current?.abort()}
                    onClose={() => setPanel(snapshot?.phase === 'finished' ? 'results' : 'none')}
                    onRemeasure={() => void remeasure()}
                    onDownloadAgain={() => {
                      const result = resultBlobRef.current;
                      if (result && race) {
                        downloadBlob(
                          result.blob,
                          `canicarrera-${race.spec.seed}-${qualityId}-${presetId}.mp4`,
                        );
                      }
                    }}
                    t={t}
                    lang={lang}
                  />
                )}
              </div>
            </div>
          )}

          <div
            className="fixed z-20 flex flex-wrap items-center justify-between gap-3"
            style={{
              bottom: 'calc(var(--safe) + 14px)',
              left: 'calc(var(--safe) + 14px)',
              right: 'calc(var(--safe) + 14px)',
            }}
          >
            {race && !immersive ? (
              <SeedPlate
                seed={race.spec.seed}
                onUseSeed={(seed) => void newRace({ seed })}
                onCopyLink={copyLink}
                copied={copied}
                t={t}
                busy={busy}
              />
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              {!immersive && snapshot?.phase === 'racing' && (
                <button
                  type="button"
                  className="btn btn-ghost px-3 sm:px-[22px]"
                  onClick={skipToEnd}
                  title={t('action.skip')}
                >
                  <span aria-hidden="true" className="text-[18px] leading-none sm:hidden">»</span>
                  <span className="hidden sm:inline">{t('action.skip')}</span>
                </button>
              )}
              {!immersive && snapshot?.phase === 'finished' && panel === 'none' && (
                <button
                  type="button"
                  className="btn px-3 sm:px-[22px]"
                  onClick={() => setPanel('results')}
                  title={t('results.title')}
                >
                  <span aria-hidden="true" className="text-[18px] leading-none sm:hidden">≡</span>
                  <span className="hidden sm:inline">{t('results.title')}</span>
                </button>
              )}
              {!immersive && (
                <button
                  type="button"
                  className="btn btn-ghost px-3 sm:px-4"
                  onClick={toggleAutoNext}
                  aria-pressed={autoNext}
                  title={autoNext ? t('action.autoNextOn') : t('action.autoNextOff')}
                >
                  <span
                    aria-hidden="true"
                    className={`text-[16px] leading-none ${autoNext ? 'text-(--leader)' : 'text-(--color-dim)'}`}
                  >
                    ↻
                  </span>
                  <span className="hidden sm:inline">
                    {autoNextRemaining !== null
                      ? t('action.autoNextIn', { seconds: autoNextRemaining })
                      : t('action.autoNext')}
                  </span>
                </button>
              )}
              {!immersive && (
                <button
                  type="button"
                  className="btn btn-primary px-4 sm:px-[22px]"
                  onClick={openNewRace}
                  disabled={busy}
                >
                  <span className="sm:hidden">{t('action.newShort')}</span>
                  <span className="hidden sm:inline">{t('action.new')}</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost px-3 sm:px-4"
                onClick={toggleFullscreen}
                aria-pressed={immersive}
                title={immersive ? t('action.exitFullscreen') : t('action.fullscreen')}
              >
                <span aria-hidden="true" className="text-[17px] leading-none">
                  {immersive ? '×' : '⛶'}
                </span>
                <span className={immersive ? '' : 'hidden sm:inline'}>
                  {immersive ? t('action.exitFullscreen') : t('action.fullscreen')}
                </span>
              </button>
            </div>
          </div>

          {busy && (
            <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#05070d]/70">
              <div className="slab px-6 py-5 text-center">
                <div className="relative h-0.5 w-40 overflow-hidden bg-white/10">
                  <div
                    className="animate-sweep absolute inset-y-0 w-1/2"
                    style={{ background: 'var(--leader)' }}
                  />
                </div>
                <p className="u-label mt-3">
                  {status === 'measuring' ? t('state.measuring') : t('state.creating')}
                </p>
              </div>
            </div>
          )}

          {race?.offline && status === 'ready' && !immersive && (
            <p
              className="u-label pointer-events-none fixed z-10 text-center"
              style={{ bottom: 'calc(var(--safe) + 76px)', left: 'calc(var(--safe) + 14px)' }}
            >
              {t('state.offline')}
            </p>
          )}
        </>
      )}
    </>
  );
}
