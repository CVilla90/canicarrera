import { useCallback, useEffect, useRef, useState } from 'react';

import { simulate } from '@shared/sim.ts';
import { ARCHETYPES } from '@shared/generator.ts';

import { RaceScene, type SceneSnapshot } from './scene/RaceScene.ts';
import { probeCapability, type Capability } from './export/capabilities.ts';
import { exportRace, downloadBlob, ExportAborted, type ExportProgress, type ExportResult } from './export/exportRace.ts';
import { qualityById } from './export/quality.ts';
import { createRace, fetchRace, requestRender, track, type RaceResult } from './lib/api.ts';
import { detectLang, makeTranslate, type Lang } from './i18n.ts';

import { SafeFrame } from './ui/SafeFrame.tsx';
import { Wordmark } from './ui/Wordmark.tsx';
import { TimingTower } from './ui/TimingTower.tsx';
import { StartLights } from './ui/StartLights.tsx';
import { SeedPlate } from './ui/SeedPlate.tsx';
import { ResultsCard } from './ui/ResultsCard.tsx';
import { ExportPanel, type ExportPhase } from './ui/ExportPanel.tsx';

type Status = 'booting' | 'creating' | 'measuring' | 'ready' | 'error';
type Panel = 'none' | 'results' | 'export';

export function App(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RaceScene | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultBlobRef = useRef<ExportResult | null>(null);
  const bootedRef = useRef(false);

  const [lang, setLang] = useState<Lang>(detectLang);
  const [status, setStatus] = useState<Status>('booting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [race, setRace] = useState<RaceResult | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [copied, setCopied] = useState(false);

  const [exportPhase, setExportPhase] = useState<ExportPhase>('choose');
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [qualityId, setQualityId] = useState('1080p30');

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

    const onResize = (): void => {
      if (!scene.isRunning && exportInFlight.current) return;
      scene.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    void boot();

    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportInFlight = useRef(false);

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
      setVideoDuration(simulate(result.spec).videoDuration);

      scene.load(result.spec);

      // Measure before the lights, not during them: a benchmark that stutters
      // the countdown is worse than one second of an honest "measuring" label.
      if (options.probe) {
        setStatus('measuring');
        const measured = await probeCapability(scene);
        setCapability(measured);
        setQualityId(measured.recommended);
        track('capability_probe', {
          tier: measured.tier,
          codec: measured.codec,
          hardware: measured.hardwareAccelerated,
          rasterFps: measured.benchmark?.rasterFps ?? null,
          pipelineFps: measured.benchmark?.pipelineFps ?? null,
        });
      }

      scene.restart();
      scene.start();
      setStatus('ready');

      const url = new URL(window.location.href);
      url.searchParams.set('c', result.spec.seed);
      url.searchParams.delete('r');
      window.history.replaceState(null, '', url);
    },
    [],
  );

  async function boot(): Promise<void> {
    setStatus('creating');
    const params = new URLSearchParams(window.location.search);
    const raceId = params.get('r');
    const seed = params.get('c');

    let result: RaceResult | null = null;
    if (raceId) result = await fetchRace(raceId);
    if (!result) result = await createRace(seed ? { seed } : {});
    await loadRace(result, { probe: true });
  }

  // Show the podium a beat after the finish, so the confetti lands first.
  useEffect(() => {
    if (snapshot?.phase !== 'finished' || panel !== 'none' || exportInFlight.current) return;
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
  }, [snapshot?.phase, panel, race]);

  // -------------------------------------------------------------- actions

  const newRace = useCallback(
    async (seed?: string): Promise<void> => {
      setStatus('creating');
      setSnapshot(null);
      const result = await createRace(seed ? { seed } : {});
      await loadRace(result);
    },
    [loadRace],
  );

  const replay = useCallback((): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    setPanel('none');
    scene.restart();
    scene.start();
  }, []);

  const skipToEnd = useCallback((): void => {
    const sim = sceneRef.current?.sim;
    if (!sim) return;
    let guard = 40000;
    while (sim.phase !== 'finished' && guard-- > 0) sim.step();
  }, []);

  const copyLink = useCallback((): void => {
    if (!race) return;
    const url = `${window.location.origin}${window.location.pathname}?c=${race.spec.seed}`;
    void navigator.clipboard?.writeText(url).then(
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

    const quality = qualityById(qualityId);
    const controller = new AbortController();
    abortRef.current = controller;
    exportInFlight.current = true;

    setPanel('export');
    setExportPhase('running');
    setExportError(null);
    setExportProgress(null);

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
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      resultBlobRef.current = result;
      setExportResult(result);
      setExportPhase('done');
      downloadBlob(result.blob, `canicarrera-${race.spec.seed}-${quality.id}.mp4`);
      track(
        'export_finished',
        {
          quality: quality.id,
          frames: result.frames,
          seconds: result.elapsedMs / 1000,
          fps: result.fps,
          bytes: result.blob.size,
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
        track('export_failed', { quality: quality.id, detail }, race.id, race.spec.seed);
      }
    } finally {
      exportInFlight.current = false;
      abortRef.current = null;
    }
  }, [race, qualityId, lang]);

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
    setQualityId(measured.recommended);
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

  // -------------------------------------------------------------- render

  const busy = status === 'creating' || status === 'measuring';
  const archetypeLabel = race ? ARCHETYPES[race.spec.archetype].label : null;

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />
      <SafeFrame />

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

          {snapshot && (
            <div
              className="fixed z-10"
              style={{ top: 'calc(var(--safe) + 14px)', right: 'calc(var(--safe) + 14px)' }}
            >
              <TimingTower snapshot={snapshot} t={t} />
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

          {panel !== 'none' && (
            <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center p-4">
              <div className="pointer-events-auto">
                {panel === 'results' && race && snapshot && (
                  <ResultsCard
                    standings={snapshot.standings}
                    metrics={race.metrics}
                    t={t}
                    busy={busy}
                    onExport={() => {
                      setExportPhase('choose');
                      setPanel('export');
                    }}
                    onNewRace={() => void newRace()}
                    onReplay={replay}
                  />
                )}
                {panel === 'export' && (
                  <ExportPanel
                    phase={exportPhase}
                    capability={capability}
                    videoDuration={videoDuration}
                    selectedId={qualityId}
                    onSelect={setQualityId}
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
                        downloadBlob(result.blob, `canicarrera-${race.spec.seed}-${qualityId}.mp4`);
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
            {race ? (
              <SeedPlate
                seed={race.spec.seed}
                onUseSeed={(seed) => void newRace(seed)}
                onCopyLink={copyLink}
                copied={copied}
                t={t}
                busy={busy}
              />
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              {snapshot?.phase === 'racing' && (
                <button type="button" className="btn btn-ghost" onClick={skipToEnd}>
                  {t('action.skip')}
                </button>
              )}
              {snapshot?.phase === 'finished' && panel === 'none' && (
                <button type="button" className="btn" onClick={() => setPanel('results')}>
                  {t('results.title')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void newRace()}
                disabled={busy}
              >
                {t('action.new')}
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

          {race?.offline && status === 'ready' && (
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
