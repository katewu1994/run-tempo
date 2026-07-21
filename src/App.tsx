import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import { analyzeSingleTrackBpm } from "./audio/analyzeSingleTrackBpm";
import { estimateAutoBeatSync } from "./audio/autoBeatSync";
import {
  getClickTempoBpm,
  getClickTempoOptions,
  getRecommendedClickSetup,
  getSingleTrackBpmDecision,
  type BpmCandidateSource,
  type ClickTempoRelation,
} from "./audio/bpmCandidates";
import { decodeAudioFile } from "./audio/decodeAudio";
import { extractRawEnergyFeatures } from "./audio/extractEnergyFeatures";
import {
  audioBufferToWavBlob,
  createWavFileName,
  type WavMetadata,
} from "./audio/exportWav";
import { createMetronomeBuffer } from "./audio/metronome";
import { copyAudioBufferSlice, mixAudio } from "./audio/mix";
import { getTempoRatio, resampleTempo } from "./audio/tempo";
import type { SingleTrackBpmAnalysis } from "./audio/singleTrackBpmTypes";
import type { LoadedAudio, MetronomeSettings } from "./audio/types";
import { BpmPanel } from "./components/BpmPanel";
import { ExportPanel } from "./components/ExportPanel";
import {
  MultiTrackPlanner,
} from "./components/MultiTrackPlanner";
import { PreviewPanel } from "./components/PreviewPanel";
import { UploadPanel } from "./components/UploadPanel";
import { WorkflowGuide, type FlowStep } from "./components/WorkflowGuide";
import { APP_COPY, type AppCopy } from "./i18n";
import {
  getPlannerApiStatus,
  PLANNER_API_BASE_URL,
  type PlannerApiStatus,
} from "./planning/plannerClient";
import { downloadBlob } from "./utils/downloadBlob";
import {
  loadSingleTrackSessionSettings,
  saveSingleTrackSessionSettings,
} from "./utils/singleTrackSessionSettings";

type AnalysisStatus = "idle" | "loading" | "analyzing" | "complete" | "failed";
type PlaybackMode = "idle" | "mix";
type ErrorKey = keyof AppCopy["errors"];
type AppMode = "single" | "multi";
type GptApiConnectionState = "checking" | PlannerApiStatus["status"];

type PlaybackHandle = {
  sources: AudioBufferSourceNode[];
  songGainNode?: GainNode;
  metronomeGainNode?: GainNode;
};

const PREVIEW_SECONDS = 30;
const BPM_AUDITION_SONG_GAIN = 0.28;
const BPM_AUDITION_CLICK_GAIN = 0.9;
const DECODE_TIMEOUT_ERROR = "decode-timeout";
const ANALYSIS_TIMEOUT_ERROR = "analysis-timeout";
const ANALYSIS_TIMEOUT_MS = 120000;

function App() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const songGainNodeRef = useRef<GainNode | null>(null);
  const metronomeGainNodeRef = useRef<GainNode | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRequestIdRef = useRef(0);
  const sessionSettingsRef = useRef(loadSingleTrackSessionSettings());
  const targetBpmRef = useRef(sessionSettingsRef.current.targetBpm);
  const [appMode, setAppMode] = useState<AppMode>("single");
  const [loadedAudio, setLoadedAudio] = useState<LoadedAudio | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [bpmAnalysis, setBpmAnalysis] = useState<SingleTrackBpmAnalysis | null>(null);
  const [selectedDetector, setSelectedDetector] =
    useState<BpmCandidateSource | null>(null);
  const [preferredDetector, setPreferredDetector] =
    useState<BpmCandidateSource | null>(
      sessionSettingsRef.current.preferredDetector,
    );
  const [clickRelation, setClickRelation] =
    useState<ClickTempoRelation>("1:1");
  const [targetBpm, setTargetBpm] = useState(
    sessionSettingsRef.current.targetBpm,
  );
  const [masterGain, setMasterGain] = useState(
    sessionSettingsRef.current.masterGain,
  );
  const [metronomeSettings, setMetronomeSettings] = useState<MetronomeSettings>({
    targetBpm: sessionSettingsRef.current.targetBpm,
    volume: sessionSettingsRef.current.clickVolume,
    clickStyle: sessionSettingsRef.current.clickStyle,
    accentEvery: sessionSettingsRef.current.accentEvery,
    offsetMs: 0,
  });
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("idle");
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [gptApiConnection, setGptApiConnection] = useState<{
    status: GptApiConnectionState;
    model: string | null;
  }>({ status: "checking", model: null });

  const copy = APP_COPY;
  const error = errorKey ? copy.errors[errorKey] : null;
  const bpmDecision = useMemo(
    () => getSingleTrackBpmDecision(bpmAnalysis),
    [bpmAnalysis],
  );
  const selectedDetectorOption = useMemo(
    () =>
      bpmDecision.detectors.find(
        (detector) => detector.source === selectedDetector,
      ) ?? null,
    [bpmDecision.detectors, selectedDetector],
  );
  const baseDetectedBpm = selectedDetectorOption?.bpm ?? null;
  const clickBpm = getClickTempoBpm(baseDetectedBpm, clickRelation);
  const tempoRatio = getTempoRatio(clickBpm, targetBpm);
  const matchedClickBpm = clickBpm
    ? Math.round(clickBpm * tempoRatio * 10) / 10
    : null;
  const clickTempoOptions = useMemo(
    () => getClickTempoOptions(baseDetectedBpm, targetBpm),
    [baseDetectedBpm, targetBpm],
  );
  const canExport = loadedAudio !== null && clickBpm !== null;
  const flowSteps = useMemo(
    () =>
      getFlowSteps({
        hasAudio: loadedAudio !== null,
        hasSourceBpm: clickBpm !== null,
        playbackMode,
        canExport,
        copy,
      }),
    [canExport, clickBpm, copy, loadedAudio, playbackMode],
  );
  const appStatus = useMemo(
    () => getAppStatus(loadedAudio !== null, playbackMode, copy),
    [copy, loadedAudio, playbackMode],
  );
  const isSingleTrackPlaying = playbackMode !== "idle";
  const isActivePlayback =
    appMode === "single"
      ? isSingleTrackPlaying
      : false;
  const visibleAppStatus =
    appMode === "single"
      ? appStatus
      : copy.status.loadAudioToStart;
  const isStepUnlocked = useCallback(
    (stepNumber: number) => {
      const step = flowSteps.find((item) => item.number === stepNumber);
      return step ? step.state !== "locked" : false;
    },
    [flowSteps],
  );
  const goToStep = useCallback(
    (stepNumber: number) => {
      if (stepNumber >= 1 && stepNumber <= flowSteps.length && isStepUnlocked(stepNumber)) {
        setCurrentStep(stepNumber);
      }
    },
    [flowSteps.length, isStepUnlocked],
  );
  const canGoNext = currentStep < flowSteps.length && isStepUnlocked(currentStep + 1);

  useEffect(() => {
    document.documentElement.lang = "en";
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    let isMounted = true;

    void getPlannerApiStatus(PLANNER_API_BASE_URL, controller.signal).then(
      (result) => {
        if (isMounted) {
          setGptApiConnection(result);
        }
      },
    );

    return () => {
      isMounted = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    saveSingleTrackSessionSettings({
      targetBpm,
      preferredDetector,
      masterGain,
      clickVolume: metronomeSettings.volume,
      clickStyle: metronomeSettings.clickStyle,
      accentEvery: metronomeSettings.accentEvery,
    });
  }, [
    masterGain,
    metronomeSettings.accentEvery,
    metronomeSettings.clickStyle,
    metronomeSettings.volume,
    preferredDetector,
    targetBpm,
  ]);

  useEffect(
    () => () => {
      analysisAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    setLiveGain(songGainNodeRef.current, masterGain);
  }, [masterGain]);

  useEffect(() => {
    setLiveGain(
      metronomeGainNodeRef.current,
      metronomeSettings.volume * masterGain,
    );
  }, [masterGain, metronomeSettings.volume]);

  const applyAutoBeatSync = useCallback(
    (
      audioBuffer: AudioBuffer,
      nextTempoRatio: number,
      nextClickBpm: number,
    ): boolean => {
      const sync = estimateAutoBeatSync(
        audioBuffer,
        nextTempoRatio,
        nextClickBpm,
      );

      if (!sync) {
        setMetronomeSettings((settings) => ({
          ...settings,
          targetBpm: nextClickBpm,
          offsetMs: 0,
        }));
        return false;
      }

      setMetronomeSettings((settings) => ({
        ...settings,
        targetBpm: nextClickBpm,
        offsetMs: sync.offsetMs,
      }));

      return true;
    },
    [],
  );

  const getAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      // Some browsers leave resume() pending; don't let it block decoding.
      // Decoding works on a suspended context, and playback re-resumes anyway.
      await Promise.race([
        audioContextRef.current.resume(),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    }

    return audioContextRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    const playback = playbackRef.current;

    if (playback) {
      playback.sources.forEach((source) => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        disconnectNode(source);
      });
      disconnectNode(playback.songGainNode);
      disconnectNode(playback.metronomeGainNode);
      playbackRef.current = null;
    }

    songGainNodeRef.current = null;
    metronomeGainNodeRef.current = null;
    setPlaybackMode("idle");
  }, []);

  const playLayeredBuffers = useCallback(
    async (
      songBuffer: AudioBuffer,
      metronomeBuffer: AudioBuffer,
      mode: PlaybackMode,
      nextSongGain: number,
      nextMetronomeGain: number,
    ) => {
      const audioContext = await getAudioContext();
      stopPlayback();

      const songSource = audioContext.createBufferSource();
      const metronomeSource = audioContext.createBufferSource();
      const songGainNode = audioContext.createGain();
      const metronomeGainNode = audioContext.createGain();

      songSource.buffer = songBuffer;
      metronomeSource.buffer = metronomeBuffer;
      songGainNode.gain.value = clampVolume(nextSongGain);
      metronomeGainNode.gain.value = clampVolume(nextMetronomeGain);

      songSource.connect(songGainNode);
      songGainNode.connect(audioContext.destination);
      metronomeSource.connect(metronomeGainNode);
      metronomeGainNode.connect(audioContext.destination);

      const playback: PlaybackHandle = {
        sources: [songSource, metronomeSource],
        songGainNode,
        metronomeGainNode,
      };
      let endedCount = 0;

      const handleEnded = (source: AudioBufferSourceNode) => {
        source.onended = null;
        disconnectNode(source);
        endedCount += 1;

        if (endedCount < playback.sources.length || playbackRef.current !== playback) {
          return;
        }

        disconnectNode(songGainNode);
        disconnectNode(metronomeGainNode);
        playbackRef.current = null;
        songGainNodeRef.current = null;
        metronomeGainNodeRef.current = null;
        setPlaybackMode("idle");
      };

      songSource.onended = () => handleEnded(songSource);
      metronomeSource.onended = () => handleEnded(metronomeSource);

      const startTime = audioContext.currentTime;
      playbackRef.current = playback;
      songGainNodeRef.current = songGainNode;
      metronomeGainNodeRef.current = metronomeGainNode;
      setPlaybackMode(mode);
      songSource.start(startTime);
      metronomeSource.start(startTime);
    },
    [getAudioContext, stopPlayback],
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      const requestId = analysisRequestIdRef.current + 1;
      analysisRequestIdRef.current = requestId;
      analysisAbortRef.current?.abort();
      const analysisController = new AbortController();
      analysisAbortRef.current = analysisController;

      stopPlayback();
      setErrorKey(null);
      setLoadedAudio(null);
      setAnalysisStatus("loading");
      setBpmAnalysis(null);
      setSelectedDetector(null);
      setMetronomeSettings((settings) => ({ ...settings, offsetMs: 0 }));

      let decoded: LoadedAudio;

      try {
        const audioContext = await getAudioContext();
        decoded = await withTimeout(
          decodeAudioFile(file, audioContext),
          30000,
          DECODE_TIMEOUT_ERROR,
        );
      } catch (decodeError) {
        if (requestId !== analysisRequestIdRef.current) {
          return;
        }
        analysisAbortRef.current = null;
        setLoadedAudio(null);
        setAnalysisStatus("failed");
        setErrorKey(
          decodeError instanceof Error && decodeError.message === DECODE_TIMEOUT_ERROR
            ? "decodeTimeout"
            : "unableDecode",
        );
        return;
      }

      if (requestId !== analysisRequestIdRef.current) {
        return;
      }

      setLoadedAudio(decoded);
      setAnalysisStatus("analyzing");
      setCurrentStep(2);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      try {
        const analysis = await withTimeout(
          analyzeSingleTrackBpm(decoded.audioBuffer, analysisController.signal),
          ANALYSIS_TIMEOUT_MS,
          ANALYSIS_TIMEOUT_ERROR,
        );

        if (requestId !== analysisRequestIdRef.current) {
          return;
        }

        const decision = getSingleTrackBpmDecision(analysis);
        const recommendation = getRecommendedClickSetup(
          decision.detectors,
          targetBpmRef.current,
        );
        const defaultDetector =
          recommendation?.source ?? decision.recommendedDetector;
        const nextDetector = decision.detectors.some(
          (detector) => detector.source === preferredDetector,
        )
          ? preferredDetector
          : defaultDetector;
        const nextBaseBpm =
          decision.detectors.find(
            (detector) => detector.source === nextDetector,
          )?.bpm ?? null;
        const nextRelation =
          getClickTempoOptions(nextBaseBpm, targetBpmRef.current).find(
            (option) => option.recommended,
          )?.relation ?? "1:1";
        const nextClickBpm = getClickTempoBpm(nextBaseBpm, nextRelation);
        const defaultTempoRatio = getTempoRatio(
          nextClickBpm,
          targetBpmRef.current,
        );
        const defaultMatchedClickBpm = nextClickBpm
          ? Math.round(nextClickBpm * defaultTempoRatio * 10) / 10
          : null;

        setBpmAnalysis(analysis);
        setSelectedDetector(nextDetector);
        setClickRelation(nextRelation);
        setPreferredDetector(nextDetector);
        setAnalysisStatus(defaultMatchedClickBpm ? "complete" : "failed");

        if (defaultMatchedClickBpm !== null) {
          applyAutoBeatSync(
            decoded.audioBuffer,
            defaultTempoRatio,
            defaultMatchedClickBpm,
          );
        }

        if (!defaultMatchedClickBpm) {
          setErrorKey("bpmInconclusive");
        }
      } catch (analysisError) {
        analysisController.abort();

        if (
          requestId !== analysisRequestIdRef.current ||
          (analysisError instanceof DOMException && analysisError.name === "AbortError")
        ) {
          return;
        }

        setBpmAnalysis(null);
        setSelectedDetector(null);
        setClickRelation("1:1");
        setAnalysisStatus("failed");
        setErrorKey("bpmInconclusive");
      } finally {
        if (requestId === analysisRequestIdRef.current) {
          analysisAbortRef.current = null;
        }
      }
    },
    [
      applyAutoBeatSync,
      getAudioContext,
      preferredDetector,
      stopPlayback,
    ],
  );

  const applyClickTempo = useCallback(
    (nextSourceClickBpm: number, nextTargetBpm = targetBpm) => {
      if (playbackMode === "mix") {
        stopPlayback();
      }

      const nextTempoRatio = getTempoRatio(nextSourceClickBpm, nextTargetBpm);
      const nextClickBpm = Math.round(
        nextSourceClickBpm * nextTempoRatio * 10,
      ) / 10;

      if (loadedAudio) {
        applyAutoBeatSync(
          loadedAudio.audioBuffer,
          nextTempoRatio,
          nextClickBpm,
        );
        return;
      }

      setMetronomeSettings((settings) => ({
        ...settings,
        targetBpm: nextClickBpm,
        offsetMs: 0,
      }));
    },
    [
      applyAutoBeatSync,
      loadedAudio,
      playbackMode,
      stopPlayback,
      targetBpm,
    ],
  );

  const handleDetectorChange = useCallback(
    (source: BpmCandidateSource) => {
      const detector = bpmDecision.detectors.find(
        (option) => option.source === source,
      );
      if (!detector) {
        return;
      }

      const recommendation = getRecommendedClickSetup([detector], targetBpm);
      const relation = recommendation?.relation ?? "1:1";
      const nextClickBpm = recommendation?.clickBpm ?? detector.bpm;

      setSelectedDetector(source);
      setClickRelation(relation);
      setPreferredDetector(source);
      applyClickTempo(nextClickBpm);
    },
    [applyClickTempo, bpmDecision.detectors, targetBpm],
  );

  const handleClickRelationChange = useCallback(
    (relation: ClickTempoRelation) => {
      const nextClickBpm = getClickTempoBpm(baseDetectedBpm, relation);
      if (nextClickBpm === null) {
        return;
      }

      setClickRelation(relation);
      applyClickTempo(nextClickBpm);
    },
    [applyClickTempo, baseDetectedBpm],
  );

  const handleTargetBpmChange = useCallback(
    (value: number) => {
      const clamped = Math.max(40, Math.min(240, value));
      targetBpmRef.current = clamped;
      setTargetBpm(clamped);

      const recommendation = getRecommendedClickSetup(
        bpmDecision.detectors,
        clamped,
      );
      if (!recommendation) {
        return;
      }

      setSelectedDetector(recommendation.source);
      setClickRelation(recommendation.relation);
      setPreferredDetector(recommendation.source);
      applyClickTempo(recommendation.clickBpm, clamped);
    },
    [applyClickTempo, bpmDecision.detectors],
  );

  const createCurrentMetronome = useCallback(
    async (durationSec: number, sampleRate?: number, volumeOverride?: number) => {
      const audioContext = await getAudioContext();
      return createMetronomeBuffer(
        audioContext,
        durationSec,
        sampleRate ?? audioContext.sampleRate,
        {
          ...metronomeSettings,
          volume: volumeOverride ?? metronomeSettings.volume,
        },
      );
    },
    [getAudioContext, metronomeSettings],
  );

  const handleMetronomeSettingsChange = useCallback(
    (nextSettings: MetronomeSettings) => {
      setMetronomeSettings(nextSettings);
    },
    [],
  );

  const playMixPreview = useCallback(async (
    previewSongGain: number,
    previewClickGain: number,
  ) => {
    if (!loadedAudio) {
      return;
    }

    if (playbackMode === "mix") {
      stopPlayback();
      return;
    }

    const audioContext = await getAudioContext();
    const sourceSlice = copyAudioBufferSlice(
      audioContext,
      loadedAudio.audioBuffer,
      PREVIEW_SECONDS * tempoRatio,
    );
    const tempoAdjustedSlice = resampleTempo(
      audioContext,
      sourceSlice,
      tempoRatio,
    );
    const metronome = await createCurrentMetronome(
      tempoAdjustedSlice.duration,
      tempoAdjustedSlice.sampleRate,
      1,
    );

    await playLayeredBuffers(
      tempoAdjustedSlice,
      metronome,
      "mix",
      previewSongGain,
      previewClickGain,
    );
  }, [
    createCurrentMetronome,
    getAudioContext,
    loadedAudio,
    playLayeredBuffers,
    playbackMode,
    stopPlayback,
    tempoRatio,
  ]);

  const handlePlayMixPreview = useCallback(
    () => playMixPreview(masterGain, metronomeSettings.volume * masterGain),
    [masterGain, metronomeSettings.volume, playMixPreview],
  );

  const handleAuditionBpmCandidate = useCallback(
    () => playMixPreview(BPM_AUDITION_SONG_GAIN, BPM_AUDITION_CLICK_GAIN),
    [playMixPreview],
  );

  const handleExport = useCallback(async (metadata: WavMetadata) => {
    if (!loadedAudio) {
      return;
    }

    const audioContext = await getAudioContext();
    const tempoAdjustedSong = resampleTempo(
      audioContext,
      loadedAudio.audioBuffer,
      tempoRatio,
    );
    const metronome = await createCurrentMetronome(
      tempoAdjustedSong.duration,
      tempoAdjustedSong.sampleRate,
    );
    const mixed = mixAudio(
      audioContext,
      tempoAdjustedSong,
      metronome,
      masterGain,
    );
    const blob = audioBufferToWavBlob(mixed, {
      ...metadata,
      runTempo: {
        version: 1,
        cadenceBpm: metronomeSettings.targetBpm,
        clickEmbedded: true,
        clickStyle: metronomeSettings.clickStyle,
        accentEvery: metronomeSettings.accentEvery,
        clickVolume: metronomeSettings.volume,
        rawEnergyFeatures: extractRawEnergyFeatures(loadedAudio.audioBuffer),
      },
    });
    downloadBlob(
      blob,
      createWavFileName(
        metadata.title || getBaseFileName(loadedAudio.fileName),
        metronomeSettings.targetBpm,
      ),
    );
  }, [
    createCurrentMetronome,
    getAudioContext,
    loadedAudio,
    metronomeSettings.targetBpm,
    masterGain,
    tempoRatio,
  ]);

  const handleClickVolumeChange = useCallback((volume: number) => {
    setMetronomeSettings((settings) => ({ ...settings, volume }));
  }, []);

  const stepHint =
    copy.stepHints[currentStep as keyof AppCopy["stepHints"]] ?? copy.stepHints[1];

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup" aria-label="RunTempo home">
          <img
            className="brand-mark"
            src="/runtempo-mark.svg?v=2"
            width="34"
            height="34"
            alt=""
            aria-hidden="true"
          />
          <span className="brand-copy">
            <span className="brand-name">RunTempo</span>
            <span className="brand-slogan">Cadence studio</span>
          </span>
        </div>
        <div className="mode-switcher" aria-label={copy.modes.ariaLabel}>
          <button
            type="button"
            className={appMode === "single" ? "active" : ""}
            aria-pressed={appMode === "single"}
            onClick={() => {
              setAppMode("single");
            }}
          >
            {copy.modes.single}
          </button>
          <button
            type="button"
            className={appMode === "multi" ? "active" : ""}
            aria-pressed={appMode === "multi"}
            onClick={() => {
              stopPlayback();
              setAppMode("multi");
            }}
          >
            {copy.modes.multi}
          </button>
        </div>
        <div className="header-utilities">
          {isActivePlayback ? (
            <button
              type="button"
              className="transport-stop"
              onClick={() => {
                stopPlayback();
              }}
            >
              <Square size={11} aria-hidden="true" />
              Stop
            </button>
          ) : null}
          <div
            className={`status-chip audio-status-chip${isActivePlayback ? " live" : ""}`}
            role="status"
            aria-live="polite"
            aria-label={visibleAppStatus}
            title={visibleAppStatus}
          >
            <AudioLines size={15} strokeWidth={2.2} aria-hidden="true" />
          </div>
          <span
            className={`gpt-api-status ${gptApiConnection.status}`}
            role="status"
            aria-live="polite"
            aria-label={copy.status.gptApi[gptApiConnection.status]}
            title={gptApiConnection.model ?? undefined}
          >
            <span className="gpt-api-status-icon" aria-hidden="true">
              <Sparkles size={12} strokeWidth={2.2} />
            </span>
            <span className="gpt-api-status-label" aria-hidden="true">
              {copy.status.gptApi[gptApiConnection.status]}
            </span>
            <span className="gpt-api-status-label-short" aria-hidden="true">
              {copy.status.gptApiShort[gptApiConnection.status]}
            </span>
          </span>
        </div>
      </header>

      <section className="product-intro" aria-labelledby="product-title">
        <div>
          <p className="eyebrow">{copy.header.eyebrow}</p>
          <h1 id="product-title">
            Run in rhythm. <span>Move with purpose.</span>
          </h1>
        </div>
        <p className="app-tagline">{copy.header.tagline}</p>
      </section>

      <section className="workspace" aria-label="RunTempo cadence studio">
        {appMode === "single" ? (
          <div className="studio-layout">
            <aside className="workflow-sidebar">
              <div className="workflow-heading">
                <span>Workflow</span>
                <strong>{currentStep} of {flowSteps.length}</strong>
              </div>
              <WorkflowGuide
                steps={flowSteps}
                currentStep={currentStep}
                ariaLabel={copy.flow.ariaLabel}
                onSelect={goToStep}
              />
              <div className="workflow-local-processing">
                <span className="workflow-local-processing-icon" aria-hidden="true">
                  <ShieldCheck size={15} strokeWidth={2.1} />
                </span>
                <span>
                  <strong>On-device</strong>
                  <small>Audio processing stays in your browser</small>
                </span>
              </div>
            </aside>

            <div className="stage">
              <div className="stage-intro">
                <span>Step {currentStep}</span>
                <h2 className="stage-title">{stepHint.title}</h2>
                <p className="stage-hint">{stepHint.hint}</p>
              </div>

            <div className="stage-panel">
              {currentStep === 1 ? (
                <UploadPanel
                  loadedAudio={loadedAudio}
                  isLoading={analysisStatus === "loading"}
                  error={error}
                  copy={copy.upload}
                  locale={copy.locale}
                  onFileSelect={handleFileSelect}
                />
              ) : null}

              {currentStep === 2 ? (
                <BpmPanel
                  status={analysisStatus}
                  detectors={bpmDecision.detectors}
                  selectedDetector={selectedDetector}
                  baseDetectedBpm={baseDetectedBpm}
                  clickOptions={clickTempoOptions}
                  selectedRelation={clickRelation}
                  clickBpm={matchedClickBpm}
                  targetBpm={targetBpm}
                  tempoRatio={tempoRatio}
                  copy={copy.bpm}
                  onDetectorChange={handleDetectorChange}
                  onRelationChange={handleClickRelationChange}
                  onTargetBpmChange={handleTargetBpmChange}
                  isAuditioning={playbackMode === "mix"}
                  onAudition={handleAuditionBpmCandidate}
                />
              ) : null}

              {currentStep === 3 ? (
                <PreviewPanel
                  playbackMode={playbackMode}
                  disabled={!loadedAudio}
                  masterGain={masterGain}
                  metronomeVolume={metronomeSettings.volume}
                  copy={copy.preview}
                  metronomeCopy={copy.metronome}
                  metronomeSettings={metronomeSettings}
                  onMasterGainChange={setMasterGain}
                  onClickVolumeChange={handleClickVolumeChange}
                  onMetronomeSettingsChange={handleMetronomeSettingsChange}
                  onPlayMixPreview={handlePlayMixPreview}
                  onStop={stopPlayback}
                />
              ) : null}

              {currentStep === 4 ? (
                <ExportPanel
                  disabled={!canExport}
                  defaultTitle={getBaseFileName(loadedAudio?.fileName ?? "")}
                  targetBpm={metronomeSettings.targetBpm}
                  copy={copy.exportPanel}
                  onExport={handleExport}
                />
              ) : null}
            </div>

            <nav className="stage-nav" aria-label={copy.nav.ariaLabel}>
              {currentStep > 1 ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                  {copy.nav.back}
                </button>
              ) : null}
              <span className="stage-progress">
                {currentStep} / {flowSteps.length}
              </span>
              {currentStep < flowSteps.length ? (
                <button
                  type="button"
                  className="primary-action"
                  disabled={!canGoNext}
                  onClick={() =>
                    setCurrentStep((step) => Math.min(flowSteps.length, step + 1))
                  }
                >
                  {copy.nav.next}
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              ) : null}
            </nav>
            </div>
          </div>
        ) : (
          <MultiTrackPlanner
            copy={copy.multiTrack}
            navCopy={copy.nav}
            statusCopy={copy.flow.statuses}
          />
        )}
      </section>
    </main>
  );
}

function getFlowSteps({
  hasAudio,
  hasSourceBpm,
  playbackMode,
  canExport,
  copy,
}: {
  hasAudio: boolean;
  hasSourceBpm: boolean;
  playbackMode: PlaybackMode;
  canExport: boolean;
  copy: AppCopy;
}): FlowStep[] {
  const cadenceReady = hasAudio && hasSourceBpm;
  const isPreviewing = playbackMode === "mix";

  return [
    {
      number: 1,
      label: copy.flow.labels.loadSong,
      status: hasAudio ? copy.flow.statuses.done : copy.flow.statuses.current,
      state: hasAudio ? "complete" : "current",
    },
    {
      number: 2,
      label: copy.flow.labels.setCadence,
      status: hasSourceBpm
        ? copy.flow.statuses.done
        : hasAudio
          ? copy.flow.statuses.current
          : copy.flow.statuses.locked,
      state: hasSourceBpm ? "complete" : hasAudio ? "current" : "locked",
    },
    {
      number: 3,
      label: copy.flow.labels.previewMix,
      status: isPreviewing
        ? copy.flow.statuses.playing
        : cadenceReady
          ? copy.flow.statuses.ready
          : copy.flow.statuses.locked,
      state: isPreviewing ? "current" : cadenceReady ? "ready" : "locked",
    },
    {
      number: 4,
      label: copy.flow.labels.export,
      status: canExport ? copy.flow.statuses.ready : copy.flow.statuses.locked,
      state: canExport ? "ready" : "locked",
    },
  ];
}

function getAppStatus(
  hasAudio: boolean,
  playbackMode: PlaybackMode,
  copy: AppCopy,
): string {
  if (playbackMode === "mix") {
    return copy.status.previewingMix;
  }

  return hasAudio ? copy.status.readyToPreview : copy.status.loadAudioToStart;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(4, value));
}

function setLiveGain(gainNode: GainNode | null, value: number): void {
  if (!gainNode) {
    return;
  }

  const now = gainNode.context.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setTargetAtTime(clampVolume(value), now, 0.015);
}

function disconnectNode(node: AudioNode | null | undefined): void {
  if (!node) {
    return;
  }

  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

export default App;

function getBaseFileName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "");
}
