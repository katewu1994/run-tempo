import { useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileAudio,
  LoaderCircle,
  MousePointerClick,
  Upload,
  Volume2,
} from "lucide-react";
import { analyzeBpm } from "../audio/analyzeBpm";
import { estimateAutoBeatSync } from "../audio/autoBeatSync";
import { getBpmCandidates, normalizeBpm } from "../audio/bpmCandidates";
import { decodeAudioFile } from "../audio/decodeAudio";
import { normalizeTrackEnergy } from "../audio/energyNormalization";
import { audioBufferToWavBlob } from "../audio/exportWav";
import { extractRawEnergyFeatures } from "../audio/extractEnergyFeatures";
import type { TrackAudioMap } from "../audio/multiTrackTypes";
import { renderExecutableMixPlan } from "../audio/renderExecutableMixPlan";
import {
  buildRunningPlanFromSettings,
  DEFAULT_RUNNING_PLAN_SETTINGS,
  type RunningPlanSettings,
} from "../domain/runningPlanBuilder";
import type {
  BpmCandidate,
  CandidateScore,
  ExecutableMixPlan,
  OpenAISelectionPlan,
  MetronomePreference,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import type { AppCopy } from "../i18n";
import { buildExecutableMixPlan } from "../planning/buildExecutableMixPlan";
import { downloadBlob } from "../utils/downloadBlob";
import {
  HttpMixPlannerClient,
  PLANNER_API_BASE_URL,
} from "../planning/plannerClient";
import { getTopCandidatesBySegment } from "../planning/scoreCandidates";
import { formatPercent } from "../utils/format";
import { CandidateScoreTable } from "./CandidateScoreTable";
import { ExecutableMixPlanView } from "./ExecutableMixPlanView";
import { MixTrackListView } from "./MixTrackListView";
import { RunningPlanSelector } from "./RunningPlanSelector";
import { TrackFeatureTable } from "./TrackFeatureTable";
import {
  getLocalizedPlanTitle,
  type MultiTrackCopy,
} from "./multiTrackFormat";
import { WorkflowGuide, type FlowStep } from "./WorkflowGuide";

const DECODE_TIMEOUT_ERROR = "decode-timeout";
const MAX_CANDIDATES_PER_SEGMENT = 10;
const MAX_TRACKS_PER_SEGMENT = 10;
const DEFAULT_CROSSFADE_SEC = 6;
const MIN_MULTI_TRACK_CLICK_VOLUME = 0.1;
const FIXED_MULTI_TRACK_CLICK_STYLE = "sharp_beep";
const FIXED_MULTI_TRACK_ACCENT_EVERY = 4;
const DEFAULT_MULTI_TRACK_CLICK_SETTINGS: MetronomePreference = {
  clickStyle: FIXED_MULTI_TRACK_CLICK_STYLE,
  clickVolume: 0.36,
  accentEvery: FIXED_MULTI_TRACK_ACCENT_EVERY,
};

type CandidateGroup = {
  segmentId: string;
  topCandidates: CandidateScore[];
};

type AnalysisMessage =
  | { kind: "preparing"; count: number }
  | { kind: "analyzing"; current: number; total: number; fileName: string }
  | { kind: "analyzed"; count: number };

type PlannerError =
  | { kind: "decodeFailures"; count: number }
  | { kind: "noDecodedFiles" }
  | { kind: "planning"; message: string | null };

type PlannerRunState = "ready" | "running" | "complete" | "failed";

type MultiTrackPlannerProps = {
  copy: MultiTrackCopy;
  navCopy: AppCopy["nav"];
  statusCopy: AppCopy["flow"]["statuses"];
};

export function MultiTrackPlanner({
  copy,
  navCopy,
  statusCopy,
}: MultiTrackPlannerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const renderedPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [tracks, setTracks] = useState<TrackFeature[]>([]);
  const [trackAudioMap, setTrackAudioMap] = useState<TrackAudioMap>({});
  const [planSettings, setPlanSettings] = useState<RunningPlanSettings>(
    DEFAULT_RUNNING_PLAN_SETTINGS,
  );
  const [candidateGroups, setCandidateGroups] = useState<CandidateGroup[] | null>(
    null,
  );
  const [selectionPlan, setSelectionPlan] = useState<OpenAISelectionPlan | null>(
    null,
  );
  const [executablePlan, setExecutablePlan] = useState<ExecutableMixPlan | null>(
    null,
  );
  const [clickSettings, setClickSettings] = useState<MetronomePreference>(
    DEFAULT_MULTI_TRACK_CLICK_SETTINGS,
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<AnalysisMessage | null>(
    null,
  );
  const [error, setError] = useState<PlannerError | null>(null);
  const [renderedMixBuffer, setRenderedMixBuffer] = useState<AudioBuffer | null>(
    null,
  );
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const selectedPlan = useMemo<RunningPlan>(
    () => buildRunningPlanFromSettings(planSettings),
    [planSettings],
  );
  const localizedPlanTitle = useMemo(
    () => getLocalizedPlanTitle(copy.runningPlan, selectedPlan),
    [copy.runningPlan, selectedPlan],
  );
  const analysisMessageText = useMemo(
    () => formatAnalysisMessage(analysisMessage, copy.upload),
    [analysisMessage, copy.upload],
  );
  const errorText = useMemo(
    () => formatPlannerError(error, copy),
    [copy, error],
  );
  const canScore = tracks.length > 0 && !isAnalyzing;
  const canGenerate =
    candidateGroups !== null &&
    candidateGroups.some((group) => group.topCandidates.length > 0) &&
    !isPlanning;
  const hasTracks = tracks.length > 0;
  const hasCandidates = candidateGroups !== null;
  const hasSelection = selectionPlan !== null;
  const hasExecutable = executablePlan !== null;
  const plannerRunState = getPlannerRunState({
    error,
    hasSelection,
    isPlanning,
  });
  const plannerStatusCopy = copy.actions.plannerStates[plannerRunState];
  const flowSteps = useMemo(
    () =>
      getMultiTrackFlowSteps({
        hasTracks,
        hasCandidates,
        hasSelection,
        hasExecutable,
        isPlanning,
        copy,
        statusCopy,
      }),
    [
      copy,
      hasCandidates,
      hasExecutable,
      hasSelection,
      hasTracks,
      isPlanning,
      statusCopy,
    ],
  );
  const isStepUnlocked = (stepNumber: number) => {
    const step = flowSteps.find((item) => item.number === stepNumber);
    return step ? step.state !== "locked" : false;
  };
  const goToStep = (stepNumber: number) => {
    if (
      stepNumber >= 1 &&
      stepNumber <= flowSteps.length &&
      isStepUnlocked(stepNumber)
    ) {
      setCurrentStep(stepNumber);
    }
  };
  const canGoBack = currentStep > 1;
  const canGoNext = getCanGoNext({
    currentStep,
    hasTracks,
    hasCandidates,
    hasSelection,
    hasExecutable,
    isAnalyzing,
    isPlanning,
    canScore,
    canGenerate,
  });
  const stepHint =
    copy.stepHints[currentStep as keyof MultiTrackCopy["stepHints"]] ??
    copy.stepHints[1];

  const stopRenderedPreview = () => {
    if (!renderedPlaybackSourceRef.current) {
      return;
    }

    const source = renderedPlaybackSourceRef.current;
    renderedPlaybackSourceRef.current = null;
    source.onended = null;

    try {
      source.stop();
    } catch {
      // The source may already have ended.
    }

    source.disconnect();
  };

  const resetRenderedOutput = () => {
    stopRenderedPreview();
    setRenderedMixBuffer(null);
    setRenderError(null);
  };

  const resetPlanningOutput = () => {
    setCandidateGroups(null);
    setSelectionPlan(null);
    setExecutablePlan(null);
    resetRenderedOutput();
  };

  const handleClickSettingsChange = (settings: MetronomePreference) => {
    const nextSettings = normalizeRequiredClickSettings(settings);

    setClickSettings(nextSettings);
    setExecutablePlan((currentPlan) =>
      currentPlan ? applyClickSettingsToPlan(currentPlan, nextSettings) : null,
    );
    resetRenderedOutput();
  };

  const getAudioContext = async () => {
    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      await Promise.race([
        audioContextRef.current.resume(),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    }

    return audioContextRef.current;
  };

  const handleFilesSelect = async (files: FileList | null) => {
    const audioFiles = Array.from(files ?? []);

    if (audioFiles.length === 0) {
      return;
    }

    setCurrentStep(1);
    setIsAnalyzing(true);
    setAnalysisMessage({ kind: "preparing", count: audioFiles.length });
    setError(null);
    setTrackAudioMap({});
    resetPlanningOutput();

    const analyzedTracks: TrackFeature[] = [];
    const nextTrackAudioMap: TrackAudioMap = {};
    let failures = 0;

    try {
      const audioContext = await getAudioContext();

      for (let index = 0; index < audioFiles.length; index += 1) {
        const file = audioFiles[index];
        setAnalysisMessage({
          kind: "analyzing",
          current: index + 1,
          total: audioFiles.length,
          fileName: file.name,
        });

        try {
          const decoded = await withTimeout(
            decodeAudioFile(file, audioContext),
            30000,
            DECODE_TIMEOUT_ERROR,
          );

          await new Promise((resolve) => window.requestAnimationFrame(resolve));

          const analysis = await analyzeBpm(decoded.audioBuffer);
          const detectedBpm = analysis.bpm ? normalizeBpm(analysis.bpm) : null;
          const trackId = createTrackId(file, index);

          nextTrackAudioMap[trackId] = decoded.audioBuffer;

          analyzedTracks.push({
            trackId,
            fileName: decoded.fileName,
            durationSec: decoded.durationSec,
            detectedBpm,
            bpmCandidates: createPlanningBpmCandidates(detectedBpm),
            beatConfidence: null,
            tempoStability: null,
            rawEnergyFeatures: extractRawEnergyFeatures(decoded.audioBuffer),
            normalizedEnergyScore: null,
          });
        } catch {
          failures += 1;
        }
      }

      const normalizedTracks = normalizeTrackEnergy(analyzedTracks);
      setTracks(normalizedTracks);
      setTrackAudioMap(nextTrackAudioMap);
      setAnalysisMessage(
        normalizedTracks.length > 0
          ? { kind: "analyzed", count: normalizedTracks.length }
          : null,
      );

      if (failures > 0) {
        setError({ kind: "decodeFailures", count: failures });
      }

      if (normalizedTracks.length === 0) {
        setError({ kind: "noDecodedFiles" });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePlanChange = (settings: RunningPlanSettings) => {
    setPlanSettings(settings);
    resetPlanningOutput();
  };

  const handleScoreCandidates = (): boolean => {
    if (!canScore) {
      return false;
    }

    const nextCandidateGroups = getTopCandidatesBySegment(
      tracks,
      selectedPlan,
      MAX_CANDIDATES_PER_SEGMENT,
    );

    setCandidateGroups(nextCandidateGroups);
    setSelectionPlan(null);
    setExecutablePlan(null);
    resetRenderedOutput();

    return true;
  };

  const handleGenerateMixPlan = async (): Promise<boolean> => {
    if (!candidateGroups) {
      return false;
    }

    setIsPlanning(true);
    setError(null);

    try {
      const client = new HttpMixPlannerClient(PLANNER_API_BASE_URL);
      const nextSelectionPlan = await client.createSelectionPlan({
        runningPlan: selectedPlan,
        tracks,
        topCandidatesBySegment: candidateGroups,
        rules: {
          allowTrackReuse: true,
          allowLoop: true,
          maxTracksPerSegment: MAX_TRACKS_PER_SEGMENT,
          preferStableCadenceGrid: true,
        },
      });
      const nextExecutablePlan = applyAutomaticBeatSyncToPlan(
        applyClickSettingsToPlan(
          buildExecutableMixPlan({
            runningPlan: selectedPlan,
            tracks,
            selectionPlan: nextSelectionPlan,
            crossfadeSec: DEFAULT_CROSSFADE_SEC,
            allowLoop: true,
          }),
          clickSettings,
        ),
        trackAudioMap,
      );

      setSelectionPlan(nextSelectionPlan);
      setExecutablePlan(nextExecutablePlan);
      resetRenderedOutput();
      return true;
    } catch (planningError) {
      setError(
        {
          kind: "planning",
          message:
            planningError instanceof Error ? planningError.message : null,
        },
      );
      return false;
    } finally {
      setIsPlanning(false);
    }
  };

  const handleNext = async () => {
    if (!canGoNext) {
      return;
    }

    if (currentStep === 1) {
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      if (!candidateGroups && !handleScoreCandidates()) {
        return;
      }

      setCurrentStep(3);
      return;
    }

    if (currentStep === 3) {
      if (selectionPlan && executablePlan) {
        setCurrentStep(4);
        return;
      }

      if (await handleGenerateMixPlan()) {
        setCurrentStep(4);
      }

      return;
    }

    if (currentStep === 4) {
      setCurrentStep(5);
    }
  };

  const renderMixBuffer = async (
    plan: ExecutableMixPlan | null = executablePlan,
  ): Promise<AudioBuffer | null> => {
    if (!plan) {
      return null;
    }

    setIsRendering(true);
    setRenderError(null);

    try {
      const audioContext = await getAudioContext();
      const renderedBuffer = await renderExecutableMixPlan({
        audioContext,
        trackAudioMap,
        plan,
      });

      setRenderedMixBuffer(renderedBuffer);
      return renderedBuffer;
    } catch (renderingError) {
      console.error(renderingError);
      setRenderError(copy.executable.renderError);
      return null;
    } finally {
      setIsRendering(false);
    }
  };

  const playRenderedMix = async (buffer: AudioBuffer) => {
    const audioContext = await getAudioContext();
    const source = audioContext.createBufferSource();

    stopRenderedPreview();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      if (renderedPlaybackSourceRef.current === source) {
        renderedPlaybackSourceRef.current = null;
      }

      source.disconnect();
    };
    source.start();
    renderedPlaybackSourceRef.current = source;
  };

  const handleRenderMixPreview = async () => {
    const renderedBuffer = await renderMixBuffer();

    if (renderedBuffer) {
      await playRenderedMix(renderedBuffer);
    }
  };

  const handleExportMixWav = async () => {
    if (!executablePlan) {
      return;
    }

    const renderedBuffer = renderedMixBuffer ?? (await renderMixBuffer(executablePlan));

    if (!renderedBuffer) {
      return;
    }

    const blob = audioBufferToWavBlob(renderedBuffer);
    downloadBlob(blob, createMultiTrackWavFileName(executablePlan.mixTitle));
  };

  return (
    <article className="multi-track-planner">
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
        </aside>

        <div className="stage">
          <div className="stage-intro">
            <span>Step {currentStep}</span>
            <h2 className="stage-title">{stepHint.title}</h2>
            <p className="stage-hint">{stepHint.hint}</p>
          </div>

        <div className="stage-panel multi-stage-panel">
          {currentStep === 1 ? (
            <>
              <section
                className="panel planner-panel"
                aria-labelledby="multi-upload-title"
              >
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">{copy.upload.eyebrow}</span>
                    <h2 id="multi-upload-title">{copy.upload.title}</h2>
                  </div>
                  <FileAudio aria-hidden="true" />
                </div>

                <label className="drop-zone multi-drop-zone">
                  <input
                    type="file"
                    multiple
                    accept="audio/*,.mp3,.wav,.m4a,.aac"
                    onChange={(event) => {
                      void handleFilesSelect(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <span className="drop-icon">
                    <Upload size={28} aria-hidden="true" />
                  </span>
                  <span>
                    {isAnalyzing
                      ? copy.upload.analyzingAudio
                      : copy.upload.chooseFiles}
                  </span>
                </label>

                <p className="field-hint">
                  {copy.upload.hint}
                </p>

                {analysisMessageText ? (
                  <p className="planner-status">{analysisMessageText}</p>
                ) : null}
                {errorText ? <p className="error-text">{errorText}</p> : null}
              </section>

              {tracks.length > 0 ? (
                <TrackFeatureTable tracks={tracks} copy={copy.tracks} />
              ) : null}
            </>
          ) : null}

          {currentStep === 2 ? (
            <RunningPlanSelector
              plan={selectedPlan}
              settings={planSettings}
              copy={copy.runningPlan}
              onChange={handlePlanChange}
            />
          ) : null}

          {currentStep === 3 && candidateGroups ? (
            <>
              <section
                className="panel planner-panel planner-mode-panel"
                aria-labelledby="planner-mode-title"
              >
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">{copy.actions.eyebrow}</span>
                    <h2 id="planner-mode-title">{copy.actions.title}</h2>
                  </div>
                  <Bot aria-hidden="true" />
                </div>

                <div
                  className={`planner-service-status ${plannerRunState}`}
                  aria-live="polite"
                  aria-busy={isPlanning}
                >
                  <span className="planner-service-icon" aria-hidden="true">
                    {plannerRunState === "running" ? (
                      <LoaderCircle size={22} />
                    ) : plannerRunState === "complete" ? (
                      <CheckCircle2 size={22} />
                    ) : plannerRunState === "failed" ? (
                      <CircleAlert size={22} />
                    ) : (
                      <Bot size={22} />
                    )}
                  </span>
                  <div className="planner-service-copy">
                    <span>{copy.actions.openaiPlanner}</span>
                    <strong>{plannerStatusCopy.title}</strong>
                    <p>{plannerStatusCopy.hint}</p>
                  </div>
                </div>
                {errorText ? <p className="error-text">{errorText}</p> : null}
              </section>

              <CandidateScoreTable
                runningPlan={selectedPlan}
                tracks={tracks}
                candidateGroups={candidateGroups}
                copy={copy.candidates}
                segmentNames={copy.runningPlan.segmentNames}
              />
            </>
          ) : null}

          {currentStep === 4 && executablePlan ? (
            <>
              <MixTrackListView
                runningPlan={selectedPlan}
                tracks={tracks}
                executablePlan={executablePlan}
                planTitle={localizedPlanTitle}
                copy={copy.selection}
                segmentNames={copy.runningPlan.segmentNames}
                interpretations={copy.candidates.interpretations}
              />
              <MultiTrackClickPanel
                settings={clickSettings}
                copy={copy.click}
                onChange={handleClickSettingsChange}
              />
            </>
          ) : null}

          {currentStep === 5 && executablePlan ? (
            <ExecutableMixPlanView
              tracks={tracks}
              executablePlan={executablePlan}
              mixTitle={executablePlan.mixTitle}
              copy={copy.executable}
              isRendering={isRendering}
              renderedDurationSec={renderedMixBuffer?.duration ?? null}
              renderError={renderError}
              onRenderPreview={() => void handleRenderMixPreview()}
              onExportWav={() => void handleExportMixWav()}
            />
          ) : null}
        </div>

        <nav className="stage-nav" aria-label={navCopy.ariaLabel}>
          <button
            type="button"
            className="secondary-action"
            disabled={!canGoBack}
            onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            {navCopy.back}
          </button>
          <span className="stage-progress">
            {currentStep} / {flowSteps.length}
          </span>
          <button
            type="button"
            className="primary-action"
            disabled={!canGoNext}
            onClick={() => {
              void handleNext();
            }}
          >
            {currentStep === 3 && isPlanning
              ? copy.actions.generating
              : currentStep === 3
                ? copy.actions.generateMixPlan
                : navCopy.next}
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
        </div>
      </div>
    </article>
  );
}

function MultiTrackClickPanel({
  settings,
  copy,
  onChange,
}: {
  settings: MetronomePreference;
  copy: MultiTrackCopy["click"];
  onChange: (settings: MetronomePreference) => void;
}) {
  return (
    <section
      className="panel planner-panel multi-click-panel"
      aria-labelledby="multi-click-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="multi-click-title">{copy.title}</h2>
        </div>
        <MousePointerClick aria-hidden="true" />
      </div>

      <dl className="summary-grid planner-summary multi-click-summary">
        <div>
          <dt>{copy.summary.status}</dt>
          <dd>{copy.summary.required}</dd>
        </div>
        <div>
          <dt>{copy.summary.style}</dt>
          <dd>{copy.clickStyleLabels[settings.clickStyle]}</dd>
        </div>
        <div>
          <dt>{copy.summary.accent}</dt>
          <dd>{copy.everyAccent(settings.accentEvery)}</dd>
        </div>
        <div>
          <dt>{copy.summary.sync}</dt>
          <dd>{copy.summary.automaticSync}</dd>
        </div>
        <div>
          <dt>{copy.summary.volume}</dt>
          <dd>{formatPercent(settings.clickVolume)}</dd>
        </div>
      </dl>

      <label className="range-field">
        <span>
          <Volume2 size={16} aria-hidden="true" />
          {copy.volumeLabel}
        </span>
        <input
          type="range"
          min={MIN_MULTI_TRACK_CLICK_VOLUME}
          max="1"
          step="0.01"
          value={settings.clickVolume}
          onChange={(event) =>
            onChange({
              ...settings,
              clickVolume: Number(event.target.value),
            })
          }
        />
        <output>{formatPercent(settings.clickVolume)}</output>
      </label>
    </section>
  );
}

function applyClickSettingsToPlan(
  plan: ExecutableMixPlan,
  settings: MetronomePreference,
): ExecutableMixPlan {
  const metronome = normalizeRequiredClickSettings(settings);

  return {
    ...plan,
    blocks: plan.blocks.map((block) => ({
      ...block,
      metronome: {
        ...block.metronome,
        enabled: true,
        ...metronome,
        offsetMs: block.metronome.offsetMs ?? 0,
      },
    })),
  };
}

function applyAutomaticBeatSyncToPlan(
  plan: ExecutableMixPlan,
  trackAudioMap: TrackAudioMap,
): ExecutableMixPlan {
  const offsetBySyncKey = new Map<string, number>();

  return {
    ...plan,
    blocks: plan.blocks.map((block) => {
      const sourceBuffer = trackAudioMap[block.trackId];
      const playbackRate = getBlockPlaybackRate(block);
      const syncKey = `${block.trackId}:${playbackRate.toFixed(6)}:${block.targetCadence.toFixed(3)}`;
      let offsetMs = offsetBySyncKey.get(syncKey);

      if (offsetMs === undefined) {
        const sync = sourceBuffer
          ? estimateAutoBeatSync(sourceBuffer, playbackRate, block.targetCadence)
          : null;

        offsetMs = sync?.offsetMs ?? 0;
        offsetBySyncKey.set(syncKey, offsetMs);
      }

      return {
        ...block,
        metronome: {
          ...block.metronome,
          offsetMs,
        },
      };
    }),
  };
}

function normalizeRequiredClickSettings(
  settings: MetronomePreference,
): MetronomePreference {
  const clickVolume = Number.isFinite(settings.clickVolume)
    ? settings.clickVolume
    : MIN_MULTI_TRACK_CLICK_VOLUME;

  return {
    ...settings,
    clickStyle: FIXED_MULTI_TRACK_CLICK_STYLE,
    clickVolume: Math.max(
      MIN_MULTI_TRACK_CLICK_VOLUME,
      Math.min(1, clickVolume),
    ),
    accentEvery: FIXED_MULTI_TRACK_ACCENT_EVERY,
  };
}

function getBlockPlaybackRate(block: ExecutableMixPlan["blocks"][number]): number {
  if (
    block.stretchDecision !== "safe_stretch" ||
    !Number.isFinite(block.stretchRatio) ||
    block.stretchRatio <= 0
  ) {
    return 1;
  }

  return block.stretchRatio;
}

function getPlannerRunState({
  error,
  hasSelection,
  isPlanning,
}: {
  error: PlannerError | null;
  hasSelection: boolean;
  isPlanning: boolean;
}): PlannerRunState {
  if (isPlanning) {
    return "running";
  }

  if (error?.kind === "planning") {
    return "failed";
  }

  if (hasSelection) {
    return "complete";
  }

  return "ready";
}

function formatAnalysisMessage(
  message: AnalysisMessage | null,
  copy: MultiTrackCopy["upload"],
): string | null {
  if (!message) {
    return null;
  }

  if (message.kind === "preparing") {
    return copy.preparingFiles(message.count);
  }

  if (message.kind === "analyzing") {
    return copy.analyzingFile(message.current, message.total, message.fileName);
  }

  return copy.analyzedTracks(message.count);
}

function getMultiTrackFlowSteps({
  hasTracks,
  hasCandidates,
  hasSelection,
  hasExecutable,
  isPlanning,
  copy,
  statusCopy,
}: {
  hasTracks: boolean;
  hasCandidates: boolean;
  hasSelection: boolean;
  hasExecutable: boolean;
  isPlanning: boolean;
  copy: MultiTrackCopy;
  statusCopy: AppCopy["flow"]["statuses"];
}): FlowStep[] {
  return [
    {
      number: 1,
      label: copy.flow.labels.loadTracks,
      status: hasTracks ? statusCopy.done : statusCopy.current,
      state: hasTracks ? "complete" : "current",
    },
    {
      number: 2,
      label: copy.flow.labels.buildPlan,
      status: hasCandidates
        ? statusCopy.done
        : hasTracks
          ? statusCopy.current
          : statusCopy.locked,
      state: hasCandidates ? "complete" : hasTracks ? "current" : "locked",
    },
    {
      number: 3,
      label: copy.flow.labels.reviewCandidates,
      status: hasSelection
        ? statusCopy.done
        : hasCandidates
          ? statusCopy.ready
          : statusCopy.locked,
      state: hasSelection ? "complete" : hasCandidates ? "ready" : "locked",
    },
    {
      number: 4,
      label: copy.flow.labels.reviewPlan,
      status: hasExecutable
        ? statusCopy.ready
        : isPlanning
          ? statusCopy.current
          : hasSelection
            ? statusCopy.ready
            : statusCopy.locked,
      state: hasExecutable
        ? "ready"
        : isPlanning
          ? "current"
          : hasSelection
            ? "ready"
            : "locked",
    },
    {
      number: 5,
      label: copy.flow.labels.export,
      status: hasExecutable ? statusCopy.ready : statusCopy.locked,
      state: hasExecutable ? "ready" : "locked",
    },
  ];
}

function getCanGoNext({
  currentStep,
  hasTracks,
  hasCandidates,
  hasSelection,
  hasExecutable,
  isAnalyzing,
  isPlanning,
  canScore,
  canGenerate,
}: {
  currentStep: number;
  hasTracks: boolean;
  hasCandidates: boolean;
  hasSelection: boolean;
  hasExecutable: boolean;
  isAnalyzing: boolean;
  isPlanning: boolean;
  canScore: boolean;
  canGenerate: boolean;
}): boolean {
  if (currentStep === 1) {
    return hasTracks && !isAnalyzing;
  }

  if (currentStep === 2) {
    return hasTracks && (hasCandidates || canScore);
  }

  if (currentStep === 3) {
    return hasCandidates && !isPlanning && (hasSelection || canGenerate);
  }

  if (currentStep === 4) {
    return hasExecutable;
  }

  return false;
}

function formatPlannerError(
  error: PlannerError | null,
  copy: MultiTrackCopy,
): string | null {
  if (!error) {
    return null;
  }

  if (error.kind === "decodeFailures") {
    return copy.upload.decodeFailures(error.count);
  }

  if (error.kind === "noDecodedFiles") {
    return copy.upload.noDecodedFiles;
  }

  return error.message ?? copy.actions.planningError;
}

function createPlanningBpmCandidates(detectedBpm: number | null): BpmCandidate[] {
  if (detectedBpm === null || !Number.isFinite(detectedBpm)) {
    return [];
  }

  return getBpmCandidates(detectedBpm).map((candidate) => ({
    bpm: candidate.value,
    interpretation: candidate.relation,
  }));
}

function createTrackId(file: File, index: number): string {
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${Date.now()}-${index}-${safeName}`;
}

function createMultiTrackWavFileName(planTitle: string): string {
  const safeTitle =
    planTitle
      .trim()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "mix";
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  return `run-tempo_${safeTitle}_${yyyy}${MM}${dd}_${HH}${mm}.wav`;
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
