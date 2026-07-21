import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileAudio,
  FolderOpen,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { estimateAutoBeatSync } from "../audio/autoBeatSync";
import { getBpmCandidates, normalizeBpm } from "../audio/bpmCandidates";
import { decodeAudioFile } from "../audio/decodeAudio";
import { normalizeTrackEnergy } from "../audio/energyNormalization";
import { audioBufferToWavBlob } from "../audio/exportWav";
import { generateCoverArtwork } from "../audio/generateCoverArt";
import {
  createMultiTrackAnalysisInput,
  MultiTrackAnalysisQueue,
  type AnalysisStage,
  type AnalysisTimings,
} from "../audio/multiTrackAnalysisQueue";
import type { TrackAudioMap, TrackFileMap } from "../audio/multiTrackTypes";
import { renderExecutableMixPlan } from "../audio/renderExecutableMixPlan";
import {
  createStandardizedBpmCandidates,
  createTrackImportKey,
  getSupportedAudioFiles,
  getTrackRelativePath,
  readRunTempoWavMetadata,
} from "../audio/standardizedTrackLibrary";
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
  TrackSourceKind,
  GlobalSequenceRules,
  MixPlanStrategy,
  MixPlanVariant,
} from "../domain/mixTypes";
import type { AppCopy } from "../i18n";
import { buildExecutableMixPlan } from "../planning/buildExecutableMixPlan";
import { downloadBlob } from "../utils/downloadBlob";
import {
  HttpMixPlannerClient,
  MockMixPlannerClient,
  PLANNER_API_BASE_URL,
} from "../planning/plannerClient";
import { getTopCandidatesBySegment } from "../planning/scoreCandidates";
import { analyzeLibraryCoverage } from "../planning/analyzeLibraryCoverage";
import { createMixPlanVariants } from "../planning/createMixPlanVariants";
import {
  moveSelection,
  summarizeSelectionPlan,
} from "../planning/editSelectionPlan";
import {
  ExecutableMixPlanView,
  type ExportRenderPhase,
  type MultiTrackExportSettings,
} from "./ExecutableMixPlanView";
import { RunningPlanSelector } from "./RunningPlanSelector";
import { TrackFeatureTable } from "./TrackFeatureTable";
import { PlanVariantPicker } from "./PlanVariantPicker";
import { MixPlanEditor } from "./MixPlanEditor";
import { type MultiTrackCopy } from "./multiTrackFormat";
import { WorkflowGuide, type FlowStep } from "./WorkflowGuide";

const DECODE_TIMEOUT_ERROR = "decode-timeout";
const MAX_CANDIDATES_PER_SEGMENT = 10;
const DEFAULT_CROSSFADE_SEC = 6;
const MIN_MULTI_TRACK_CLICK_VOLUME = 0.1;
const FIXED_MULTI_TRACK_CLICK_STYLE = "sharp_beep";
const FIXED_MULTI_TRACK_ACCENT_EVERY = 4;
const DEFAULT_MULTI_TRACK_CLICK_SETTINGS: MetronomePreference = {
  clickStyle: FIXED_MULTI_TRACK_CLICK_STYLE,
  clickVolume: 0.36,
  accentEvery: FIXED_MULTI_TRACK_ACCENT_EVERY,
};
const DEFAULT_SEQUENCE_RULES: GlobalSequenceRules = {
  minRepeatGapTracks: 3,
  maxTracksPerSegment: 10,
  preferFolderVariety: true,
};
const DIRECTORY_INPUT_PROPS = {
  directory: "",
  webkitdirectory: "",
} as Record<string, string>;

type CandidateGroup = {
  segmentId: string;
  topCandidates: CandidateScore[];
};

type AnalysisMessage =
  | { kind: "preparing"; count: number }
  | {
      kind: "processing";
      current: number;
      total: number;
      fileName: string;
      stage: AnalysisStage | "decoding";
    }
  | {
      kind: "imported";
      added: number;
      total: number;
      duplicates: number;
      invalidNames: number;
    };

type PlannerError =
  | { kind: "decodeFailures"; count: number }
  | { kind: "noDecodedFiles" }
  | { kind: "noAudioFiles" }
  | { kind: "planning"; message: string | null };

type PlannerResultSource = "gpt" | "local" | null;
type RenderIntent = "export";

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
  const importRequestIdRef = useRef(0);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const analysisQueueRef = useRef<MultiTrackAnalysisQueue | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [tracks, setTracks] = useState<TrackFeature[]>([]);
  const [trackFileMap, setTrackFileMap] = useState<TrackFileMap>({});
  const [selectedTrackAudioMap, setSelectedTrackAudioMap] =
    useState<TrackAudioMap>({});
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [plannerResultSource, setPlannerResultSource] =
    useState<PlannerResultSource>(null);
  const [planVariants, setPlanVariants] = useState<MixPlanVariant[]>([]);
  const [activeVariantId, setActiveVariantId] =
    useState<MixPlanStrategy>("balanced");
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [trimToPlanDuration, setTrimToPlanDuration] = useState(true);
  const [analysisMessage, setAnalysisMessage] = useState<AnalysisMessage | null>(
    null,
  );
  const [error, setError] = useState<PlannerError | null>(null);
  const [renderedMixBuffer, setRenderedMixBuffer] = useState<AudioBuffer | null>(
    null,
  );
  const [renderIntent, setRenderIntent] = useState<RenderIntent | null>(null);
  const [exportRenderPhase, setExportRenderPhase] =
    useState<ExportRenderPhase | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const isRendering = renderIntent !== null;

  useEffect(() => {
    return () => {
      importRequestIdRef.current += 1;
      analysisAbortControllerRef.current?.abort();
      analysisQueueRef.current?.dispose();
      const audioContext = audioContextRef.current;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => {
          // Hot reload or another cleanup may close it first.
        });
      }
    };
  }, []);

  const selectedPlan = useMemo<RunningPlan>(
    () => buildRunningPlanFromSettings(planSettings),
    [planSettings],
  );
  const analysisMessageText = useMemo(
    () => formatAnalysisMessage(analysisMessage, copy.upload),
    [analysisMessage, copy.upload],
  );
  const importProgress = useMemo(() => {
    if (analysisMessage?.kind === "processing") {
      return Math.round(
        ((analysisMessage.current - 1 + getAnalysisStageProgress(analysisMessage.stage)) /
          analysisMessage.total) *
          100,
      );
    }

    return analysisMessage?.kind === "preparing" ? 0 : null;
  }, [analysisMessage]);
  const errorText = useMemo(
    () => formatPlannerError(error, copy),
    [copy, error],
  );
  const canScore = tracks.length > 0 && !isAnalyzing;
  const hasTracks = tracks.length > 0;
  const isClickReviewComplete = useMemo(
    () =>
      hasTracks &&
      tracks.every((track) => track.embeddedClickStatus !== "suspected"),
    [hasTracks, tracks],
  );
  const scoredCandidateGroups = useMemo<CandidateGroup[]>(
    () =>
      hasTracks
        ? getTopCandidatesBySegment(
            tracks,
            selectedPlan,
            MAX_CANDIDATES_PER_SEGMENT,
          )
        : [],
    [hasTracks, selectedPlan, tracks],
  );
  const missingCandidateCount =
    scoredCandidateGroups.filter((group) => group.topCandidates.length === 0)
      .length;
  const coverageReport = useMemo(
    () =>
      hasTracks
        ? analyzeLibraryCoverage({
            runningPlan: selectedPlan,
            tracks,
            candidateGroups: scoredCandidateGroups,
          })
        : null,
    [hasTracks, scoredCandidateGroups, selectedPlan, tracks],
  );
  const hasCandidates = candidateGroups !== null;
  const hasSelection = selectionPlan !== null;
  const hasExecutable = executablePlan !== null;
  const flowSteps = useMemo(
    () =>
      getMultiTrackFlowSteps({
        hasTracks,
        isClickReviewComplete,
        hasCandidates,
        hasSelection,
        hasExecutable,
        isPlanning: isPlanning || isApplyingPlan,
        isAnalyzing,
        copy,
        statusCopy,
      }).map((step) =>
        step.number === currentStep && step.state !== "locked"
          ? { ...step, status: statusCopy.current }
          : step,
      ),
    [
      copy,
      currentStep,
      hasCandidates,
      hasExecutable,
      isClickReviewComplete,
      hasSelection,
      hasTracks,
      isApplyingPlan,
      isAnalyzing,
      isPlanning,
      statusCopy,
    ],
  );
  const goToStep = (stepNumber: number) => {
    const step = flowSteps.find((item) => item.number === stepNumber);

    if (!isRendering && step && step.state !== "locked") {
      setCurrentStep(stepNumber);
    }
  };
  const canGoBack = currentStep > 1 && !isRendering;
  const canGoNext =
    currentStep === 1
      ? hasTracks && !isAnalyzing
      : currentStep === 2
        ? hasTracks && isClickReviewComplete && !isAnalyzing
        : currentStep === 3
        ? hasTracks &&
          canScore &&
          scoredCandidateGroups.length > 0 &&
          missingCandidateCount === 0 &&
          !isPlanning &&
          !isApplyingPlan
        : currentStep === 4
          ? hasExecutable && !isApplyingPlan
        : false;
  const stepHint =
    copy.stepHints[currentStep as keyof MultiTrackCopy["stepHints"]] ??
    copy.stepHints[1];

  const resetRenderedOutput = () => {
    setRenderedMixBuffer(null);
    setRenderError(null);
  };

  const resetPlanningOutput = () => {
    setCandidateGroups(null);
    setSelectionPlan(null);
    setExecutablePlan(null);
    setSelectedTrackAudioMap({});
    setPlannerResultSource(null);
    setPlanVariants([]);
    setActiveVariantId("balanced");
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

  const getAnalysisQueue = () => {
    analysisQueueRef.current ??= new MultiTrackAnalysisQueue();
    return analysisQueueRef.current;
  };

  const handleFilesSelect = async (
    files: FileList | null,
  ) => {
    const supportedFiles = getSupportedAudioFiles(Array.from(files ?? []));

    if (supportedFiles.length === 0) {
      setError({ kind: "noAudioFiles" });
      return;
    }

    const existingImportKeys = new Set(tracks.map((track) => track.importKey));
    let duplicateCount = 0;
    const importEntries = supportedFiles.flatMap((file) => {
      const importKey = createTrackImportKey(file, "raw");

      if (existingImportKeys.has(importKey)) {
        duplicateCount += 1;
        return [];
      }

      existingImportKeys.add(importKey);
      return [{ file, importKey }];
    });

    if (importEntries.length === 0) {
      setAnalysisMessage({
        kind: "imported",
        added: 0,
        total: tracks.length,
        duplicates: duplicateCount,
        invalidNames: 0,
      });
      setError(null);
      return;
    }

    setCurrentStep(1);
    setIsAnalyzing(true);
    setAnalysisMessage({ kind: "preparing", count: importEntries.length });
    setError(null);
    resetPlanningOutput();

    const importedTracks: TrackFeature[] = [];
    const stageTimings: Partial<Record<keyof AnalysisTimings, number>> = {};
    let failures = 0;
    const requestId = ++importRequestIdRef.current;
    analysisAbortControllerRef.current?.abort();
    const analysisController = new AbortController();
    analysisAbortControllerRef.current = analysisController;
    const importStartedAt = performance.now();

    try {
      const audioContext = await getAudioContext();

      for (let index = 0; index < importEntries.length; index += 1) {
        if (requestId !== importRequestIdRef.current) {
          return;
        }
        const { file, importKey } = importEntries[index];
        const relativePath = getTrackRelativePath(file);
        setAnalysisMessage({
          kind: "processing",
          current: index + 1,
          total: importEntries.length,
          fileName: relativePath,
          stage: "decoding",
        });

        try {
          const embeddedMetadata = await readRunTempoWavMetadata(file);
          const embeddedCadenceBpm = embeddedMetadata?.cadenceBpm ?? null;
          const sourceKind: TrackSourceKind = embeddedMetadata ? "standardized" : "raw";

          const decoded = await withTimeout(
            decodeAudioFile(file, audioContext),
            30000,
            DECODE_TIMEOUT_ERROR,
          );

          await new Promise((resolve) => window.requestAnimationFrame(resolve));
          const analysis = await getAnalysisQueue().enqueue(
            createMultiTrackAnalysisInput(
              decoded.audioBuffer,
              embeddedCadenceBpm,
              embeddedMetadata?.rawEnergyFeatures ?? null,
            ),
            {
              signal: analysisController.signal,
              onProgress: (stage) => {
                if (requestId === importRequestIdRef.current) {
                  setAnalysisMessage({
                    kind: "processing",
                    current: index + 1,
                    total: importEntries.length,
                    fileName: relativePath,
                    stage,
                  });
                }
              },
            },
          );

          if (requestId !== importRequestIdRef.current) {
            return;
          }

          for (const [stage, durationMs] of Object.entries(analysis.timings)) {
            const stageKey = stage as keyof AnalysisTimings;
            stageTimings[stageKey] = (stageTimings[stageKey] ?? 0) + durationMs;
          }

          const trackId = createTrackId(file, sourceKind, index);
          const detectedBpm = analysis.detectedBpm
            ? normalizeBpm(analysis.detectedBpm)
            : null;
          const track: TrackFeature = {
            trackId,
            importKey,
            fileName: decoded.fileName,
            relativePath: relativePath === file.name ? null : relativePath,
            sourceKind,
            embeddedClickStatus: analysis.clickDetection.status,
            embeddedClickConfidence: analysis.clickDetection.confidence,
            embeddedCadenceBpm,
            durationSec: decoded.durationSec,
            detectedBpm,
            bpmCandidates:
              embeddedCadenceBpm !== null
                ? createStandardizedBpmCandidates(embeddedCadenceBpm)
                : createPlanningBpmCandidates(detectedBpm),
            beatConfidence: embeddedCadenceBpm !== null ? 1 : null,
            tempoStability: embeddedCadenceBpm !== null ? 1 : null,
            rawEnergyFeatures: analysis.rawEnergyFeatures,
            energyFeatureSource: embeddedMetadata?.rawEnergyFeatures
              ? "embedded"
              : "analyzed",
            normalizedEnergyScore: null,
            musicalKey: analysis.musicalKey,
            mood: analysis.mood,
            energyStructure: analysis.energyStructure,
          };

          importedTracks.push(track);
          setTracks((current) => normalizeTrackEnergy([...current, track]));
          setTrackFileMap((current) => ({ ...current, [trackId]: file }));
        } catch (analysisError) {
          if (isAbortError(analysisError) || requestId !== importRequestIdRef.current) {
            return;
          }
          failures += 1;
        }
      }

      setAnalysisMessage({
        kind: "imported",
        added: importedTracks.length,
        total: tracks.length + importedTracks.length,
        duplicates: duplicateCount,
        invalidNames: 0,
      });

      console.info("RunTempo multi-track analysis timings", {
        elapsedMs: Math.round(performance.now() - importStartedAt),
        tracks: importedTracks.length,
        stages: stageTimings,
      });

      if (importedTracks.length > 0) {
        setCurrentStep(2);
      }

      if (failures > 0) {
        setError({ kind: "decodeFailures", count: failures });
      }

      if (importedTracks.length === 0 && tracks.length === 0) {
        setError({ kind: "noDecodedFiles" });
      }
    } finally {
      if (requestId === importRequestIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleClearLibrary = () => {
    importRequestIdRef.current += 1;
    analysisAbortControllerRef.current?.abort();
    setCurrentStep(1);
    setTracks([]);
    setTrackFileMap({});
    setSelectedTrackAudioMap({});
    setAnalysisMessage(null);
    setError(null);
    resetPlanningOutput();
  };

  const handleRemoveTrack = (trackId: string) => {
    setTracks((current) =>
      normalizeTrackEnergy(current.filter((track) => track.trackId !== trackId)),
    );
    setTrackFileMap((current) => {
      const next = { ...current };
      delete next[trackId];
      return next;
    });
    resetPlanningOutput();
  };

  const handleEmbeddedClickChange = (trackId: string, isConfirmed: boolean) => {
    setTracks((current) =>
      current.map((track) =>
        track.trackId === trackId
          ? {
              ...track,
              embeddedClickStatus: isConfirmed ? "confirmed" : "not_detected",
              embeddedClickConfidence: isConfirmed ? 1 : 0,
            }
          : track,
      ),
    );
    resetPlanningOutput();
  };

  const handlePlanChange = (settings: RunningPlanSettings) => {
    setPlanSettings(settings);
    resetPlanningOutput();
  };

  const handleScoreCandidates = (): CandidateGroup[] | null => {
    if (!canScore) {
      return null;
    }

    const nextCandidateGroups = scoredCandidateGroups;

    setCandidateGroups(nextCandidateGroups);
    setSelectionPlan(null);
    setExecutablePlan(null);
    resetRenderedOutput();

    return nextCandidateGroups;
  };

  const buildLoadedExecutablePlan = async (
    nextSelectionPlan: OpenAISelectionPlan,
    shouldTrimToPlanDuration: boolean = trimToPlanDuration,
  ) => {
    const baseExecutablePlan = applyClickSettingsToPlan(
      buildExecutableMixPlan({
        runningPlan: selectedPlan,
        tracks,
        selectionPlan: nextSelectionPlan,
        crossfadeSec: DEFAULT_CROSSFADE_SEC,
        allowLoop: true,
        trimToPlanDuration: shouldTrimToPlanDuration,
      }),
      DEFAULT_MULTI_TRACK_CLICK_SETTINGS,
    );
    const audioContext = await getAudioContext();
    const nextTrackAudioMap = await loadTrackAudioForPlan(
      baseExecutablePlan,
      trackFileMap,
      audioContext,
    );

    return {
      executablePlan: applyAutomaticBeatSyncToPlan(
        baseExecutablePlan,
        nextTrackAudioMap,
      ),
      trackAudioMap: nextTrackAudioMap,
    };
  };

  const applySelectionPlan = async (
    nextSelectionPlan: OpenAISelectionPlan,
    targetVariantId: MixPlanStrategy = activeVariantId,
  ) => {
    setIsApplyingPlan(true);
    setError(null);

    try {
      const loaded = await buildLoadedExecutablePlan(nextSelectionPlan);
      setSelectionPlan(nextSelectionPlan);
      setExecutablePlan(loaded.executablePlan);
      setSelectedTrackAudioMap(loaded.trackAudioMap);
      setPlanVariants((current) =>
        current.map((variant) =>
          variant.variantId === targetVariantId
            ? {
                ...variant,
                selectionPlan: nextSelectionPlan,
                summary: summarizeSelectionPlan(
                  nextSelectionPlan,
                  candidateGroups ?? [],
                ),
              }
            : variant,
        ),
      );
      resetRenderedOutput();
    } catch (planningError) {
      setError({
        kind: "planning",
        message: planningError instanceof Error ? planningError.message : null,
      });
    } finally {
      setIsApplyingPlan(false);
    }
  };

  const handleGenerateMixPlan = async (
    planningGroups: CandidateGroup[] | null = candidateGroups,
  ): Promise<boolean> => {
    const canGeneratePlan =
      planningGroups !== null &&
      planningGroups.length > 0 &&
      planningGroups.every((group) => group.topCandidates.length > 0) &&
      !isPlanning &&
      !isApplyingPlan;

    if (!planningGroups || !canGeneratePlan) {
      return false;
    }

    setIsPlanning(true);
    setError(null);

    try {
      const plannerInput = {
        runningPlan: selectedPlan,
        tracks,
        topCandidatesBySegment: planningGroups,
        rules: {
          allowTrackReuse: true,
          allowLoop: true,
          maxTracksPerSegment: DEFAULT_SEQUENCE_RULES.maxTracksPerSegment,
          preferStableCadenceGrid: true,
          minRepeatGapTracks: DEFAULT_SEQUENCE_RULES.minRepeatGapTracks,
          preferFolderVariety: DEFAULT_SEQUENCE_RULES.preferFolderVariety,
        },
      };
      let nextSelectionPlan: OpenAISelectionPlan;
      let nextPlannerSource: PlannerResultSource;

      try {
        nextSelectionPlan = await new HttpMixPlannerClient(
          PLANNER_API_BASE_URL,
        ).createSelectionPlan(plannerInput);
        nextPlannerSource = "gpt";
      } catch (planningError) {
        console.warn("GPT planner unavailable; using local planner.", planningError);
        nextSelectionPlan = await new MockMixPlannerClient().createSelectionPlan(
          plannerInput,
        );
        nextPlannerSource = "local";
      }

      const nextVariants = createMixPlanVariants({
        runningPlan: selectedPlan,
        tracks,
        candidateGroups: planningGroups,
        rules: DEFAULT_SEQUENCE_RULES,
        preferredSelectionPlan: nextSelectionPlan,
      });
      const balancedVariant =
        nextVariants.find((variant) => variant.variantId === "balanced") ??
        nextVariants[0];

      if (!balancedVariant) {
        throw new Error("No plan variants could be generated.");
      }

      const loaded = await buildLoadedExecutablePlan(
        balancedVariant.selectionPlan,
      );

      if (loaded.executablePlan.blocks.length === 0) {
        throw new Error(copy.actions.planningError);
      }

      setPlanVariants(nextVariants);
      setActiveVariantId(balancedVariant.variantId);
      setSelectionPlan(balancedVariant.selectionPlan);
      setExecutablePlan(loaded.executablePlan);
      setSelectedTrackAudioMap(loaded.trackAudioMap);
      setPlannerResultSource(nextPlannerSource);
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

  const handleSelectVariant = async (variantId: MixPlanStrategy) => {
    const variant = planVariants.find((item) => item.variantId === variantId);

    if (!variant || isApplyingPlan || isPlanning) {
      return;
    }

    setActiveVariantId(variantId);
    await applySelectionPlan(variant.selectionPlan, variantId);
  };

  const handleMoveSelection = async (
    segmentId: string,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (!selectionPlan || fromIndex === toIndex) {
      return;
    }

    await applySelectionPlan(
      moveSelection(selectionPlan, segmentId, fromIndex, toIndex),
    );
  };

  const handleTrimToPlanDurationChange = async (shouldTrim: boolean) => {
    if (!selectionPlan || shouldTrim === trimToPlanDuration || isApplyingPlan) {
      return;
    }

    setTrimToPlanDuration(shouldTrim);
    setIsApplyingPlan(true);
    setError(null);

    try {
      const loaded = await buildLoadedExecutablePlan(selectionPlan, shouldTrim);
      setExecutablePlan(loaded.executablePlan);
      setSelectedTrackAudioMap(loaded.trackAudioMap);
      resetRenderedOutput();
    } catch (planningError) {
      setTrimToPlanDuration(!shouldTrim);
      setError({
        kind: "planning",
        message: planningError instanceof Error ? planningError.message : null,
      });
    } finally {
      setIsApplyingPlan(false);
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
      setCurrentStep(3);
      return;
    }

    if (currentStep === 3) {
      const planningGroups = candidateGroups ?? handleScoreCandidates();
      const missingCount =
        planningGroups?.filter((group) => group.topCandidates.length === 0)
          .length ?? 0;

      if (missingCount > 0) {
        setError({
          kind: "planning",
          message: copy.candidates.coverageMissing(missingCount),
        });
        return;
      }

      if (await handleGenerateMixPlan(planningGroups)) {
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

    const audioContext = await getAudioContext();
    const renderedBuffer = await renderExecutableMixPlan({
      audioContext,
      trackAudioMap: selectedTrackAudioMap,
      plan,
    });

    setRenderedMixBuffer(renderedBuffer);
    return renderedBuffer;
  };

  const handleExportMixWav = async ({
    fileName,
    artworkFile,
    generatedCoverInput,
  }: MultiTrackExportSettings) => {
    if (!executablePlan) {
      return;
    }

    setRenderIntent("export");
    setExportRenderPhase("mix");
    setRenderError(null);

    try {
      await waitForNextPaint();
      const renderedBuffer =
        renderedMixBuffer ?? (await renderMixBuffer(executablePlan));

      if (!renderedBuffer) {
        return;
      }

      setExportRenderPhase("artwork");
      await waitForNextPaint();
      const artwork = artworkFile
        ? {
            data: new Uint8Array(await artworkFile.arrayBuffer()),
            mimeType: artworkFile.type || "image/jpeg",
          }
        : await generateCoverArtwork(generatedCoverInput);

      setExportRenderPhase("encode");
      await waitForNextPaint();
      const blob = audioBufferToWavBlob(renderedBuffer, {
        title: fileName.replace(/\.wav$/i, ""),
        artwork,
      });
      downloadBlob(blob, fileName);
    } catch (renderingError) {
      console.error(renderingError);
      setRenderError(copy.executable.renderError);
    } finally {
      setRenderIntent(null);
      setExportRenderPhase(null);
    }
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

          <div className="stage-panel multi-stage-panel">
            {currentStep === 1 ? (
              <>
              <section
                className="panel planner-panel upload-panel multi-library-panel"
                aria-labelledby="multi-upload-title"
              >
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">{copy.upload.eyebrow}</span>
                    <h2 id="multi-upload-title">{copy.upload.title}</h2>
                  </div>
                  <FileAudio aria-hidden="true" />
                </div>

                <div className="source-workspace multi-library-source-workspace">
                  <div className="source-method-intro">
                    <div>
                      <span className="source-method-kicker">
                        {copy.upload.standardizedKicker}
                      </span>
                      <h3>{copy.upload.standardizedTitle}</h3>
                      <p>{copy.upload.standardizedHint}</p>
                    </div>
                  </div>
                  <label
                    className={`drop-zone compact-drop-zone multi-drop-zone${
                      isAnalyzing ? " is-importing" : ""
                    }`}
                  >
                    <input
                      {...DIRECTORY_INPUT_PROPS}
                      type="file"
                      multiple
                      accept="audio/*,.mp3,.wav,.m4a,.aac"
                      disabled={isAnalyzing}
                      onChange={(event) => {
                        void handleFilesSelect(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <span className="drop-icon">
                      <FolderOpen size={24} aria-hidden="true" />
                    </span>
                    <span className="drop-copy">
                      <strong>
                        {isAnalyzing
                          ? copy.upload.analyzingAudio
                          : copy.upload.chooseFolder}
                      </strong>
                      <small>{copy.upload.standardizedFileRule}</small>
                    </span>
                    {isAnalyzing ? (
                      <span
                        className="multi-import-progress"
                        role="status"
                        aria-live="polite"
                      >
                        <span className="multi-import-progress-copy">
                          <span className="multi-import-progress-state">
                            <LoaderCircle size={16} aria-hidden="true" />
                            <span>
                              {analysisMessage?.kind === "processing"
                                ? `${analysisMessage.current} / ${analysisMessage.total}`
                                : copy.upload.analyzingAudio}
                            </span>
                          </span>
                          <b className="multi-import-progress-percent">
                            {importProgress ?? 0}%
                          </b>
                        </span>
                        {analysisMessage?.kind === "processing" ? (
                          <span className="multi-import-progress-details">
                            <span
                              className="multi-import-progress-file"
                              title={analysisMessage.fileName}
                            >
                              <FileAudio size={14} aria-hidden="true" />
                              <span>{analysisMessage.fileName}</span>
                            </span>
                            <span className="multi-import-progress-stage">
                              {copy.upload.processingStages[analysisMessage.stage]}
                            </span>
                          </span>
                        ) : (
                          <span className="multi-import-progress-summary">
                            {analysisMessageText ?? copy.upload.analyzingAudio}
                          </span>
                        )}
                        <span
                          className="multi-import-progress-track"
                          aria-hidden="true"
                        >
                          <span style={{ width: `${importProgress ?? 0}%` }} />
                        </span>
                      </span>
                    ) : null}
                  </label>
                  {tracks.length > 0 ? (
                    <div className="multi-library-clear-row">
                      <button
                        type="button"
                        className="secondary-action clear-library-action"
                        disabled={isAnalyzing}
                        onClick={handleClearLibrary}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        {copy.upload.clearLibrary}
                      </button>
                    </div>
                  ) : null}
                </div>

                {errorText ? <p className="error-text">{errorText}</p> : null}
              </section>
              </>
            ) : null}

            {currentStep === 2 ? (
              <>
                {tracks.length > 0 ? (
                  <TrackFeatureTable
                    tracks={tracks}
                    copy={copy.tracks}
                    onRemove={handleRemoveTrack}
                    onEmbeddedClickChange={handleEmbeddedClickChange}
                  />
                ) : null}
                {errorText ? <p className="error-text">{errorText}</p> : null}
              </>
            ) : null}

            {currentStep === 3 ? (
              <>
                <RunningPlanSelector
                  plan={selectedPlan}
                  settings={planSettings}
                  copy={copy.runningPlan}
                  coverageReport={coverageReport}
                  coverageCopy={copy.coverage}
                  onChange={handlePlanChange}
                />
                {errorText ? <p className="error-text">{errorText}</p> : null}
              </>
            ) : null}

            {currentStep === 4 && candidateGroups && executablePlan ? (
              <div className="step-four-workspace">
                {planVariants.length > 0 && plannerResultSource ? (
                  <PlanVariantPicker
                    variants={planVariants}
                    activeVariantId={activeVariantId}
                    isBusy={isApplyingPlan || isPlanning}
                    source={plannerResultSource}
                    copy={copy.variants}
                    onSelect={(variantId) => {
                      void handleSelectVariant(variantId);
                    }}
                  />
                ) : null}
                {selectionPlan && candidateGroups ? (
                  <MixPlanEditor
                    runningPlan={selectedPlan}
                    selectionPlan={selectionPlan}
                    executablePlan={executablePlan}
                    trimToPlanDuration={trimToPlanDuration}
                    tracks={tracks}
                    candidateGroups={candidateGroups}
                    isBusy={isApplyingPlan || isPlanning}
                    copy={copy.editor}
                    analysisCopy={copy.candidates}
                    segmentNames={copy.runningPlan.segmentNames}
                    onMove={(segmentId, fromIndex, toIndex) => {
                      void handleMoveSelection(segmentId, fromIndex, toIndex);
                    }}
                    onTrimToPlanDurationChange={(shouldTrim) => {
                      void handleTrimToPlanDurationChange(shouldTrim);
                    }}
                  />
                ) : null}
                {errorText ? <p className="error-text">{errorText}</p> : null}
              </div>
            ) : null}

            {currentStep === 5 && executablePlan ? (
              <ExecutableMixPlanView
                executablePlan={executablePlan}
                planModeLabel={copy.runningPlan.modes[planSettings.mode]}
                planningDirectionLabel={copy.variants.names[activeVariantId]}
                copy={copy.executable}
                isRendering={isRendering}
                renderIntent={renderIntent}
                exportRenderPhase={exportRenderPhase}
                renderError={renderError}
                onExportWav={(settings) => void handleExportMixWav(settings)}
              />
            ) : null}
          </div>

          <nav className="stage-nav" aria-label={navCopy.ariaLabel}>
            {currentStep > 1 ? (
              <button
                type="button"
                className="secondary-action"
                disabled={!canGoBack}
                onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                {navCopy.back}
              </button>
            ) : null}
            <span className="stage-progress">
              {currentStep} / {flowSteps.length}
            </span>
            {currentStep < 5 ? (
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
            ) : null}
          </nav>
        </div>
      </div>
    </article>
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
        ...metronome,
        enabled: block.metronome.enabled,
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
      if (!block.metronome.enabled) {
        return block;
      }

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

async function loadTrackAudioForPlan(
  plan: ExecutableMixPlan,
  trackFileMap: TrackFileMap,
  audioContext: AudioContext,
): Promise<TrackAudioMap> {
  const trackIds = [...new Set(plan.blocks.map((block) => block.trackId))];
  const result: TrackAudioMap = {};

  for (const trackId of trackIds) {
    const file = trackFileMap[trackId];

    if (!file) {
      throw new Error(`The source file for track ${trackId} is unavailable.`);
    }

    const decoded = await withTimeout(
      decodeAudioFile(file, audioContext),
      30000,
      DECODE_TIMEOUT_ERROR,
    );
    result[trackId] = decoded.audioBuffer;
  }

  return result;
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

  if (message.kind === "processing") {
    return `${copy.processingFile(
      message.current,
      message.total,
      message.fileName,
    )} · ${copy.processingStages[message.stage]}`;
  }

  return copy.importedTracks(
    message.added,
    message.total,
    message.duplicates,
    message.invalidNames,
  );
}

function getMultiTrackFlowSteps({
  hasTracks,
  isClickReviewComplete,
  hasCandidates,
  hasSelection,
  hasExecutable,
  isPlanning,
  isAnalyzing,
  copy,
  statusCopy,
}: {
  hasTracks: boolean;
  isClickReviewComplete: boolean;
  hasCandidates: boolean;
  hasSelection: boolean;
  hasExecutable: boolean;
  isPlanning: boolean;
  isAnalyzing: boolean;
  copy: MultiTrackCopy;
  statusCopy: AppCopy["flow"]["statuses"];
}): FlowStep[] {
  if (isAnalyzing) {
    return [
      {
        number: 1,
        label: copy.flow.labels.loadTracks,
        status: statusCopy.current,
        state: "current",
      },
      {
        number: 2,
        label: copy.flow.labels.confirmTracks,
        status: statusCopy.locked,
        state: "locked",
      },
      {
        number: 3,
        label: copy.flow.labels.buildPlan,
        status: statusCopy.locked,
        state: "locked",
      },
      {
        number: 4,
        label: copy.flow.labels.reviewPlan,
        status: statusCopy.locked,
        state: "locked",
      },
      {
        number: 5,
        label: copy.flow.labels.export,
        status: statusCopy.locked,
        state: "locked",
      },
    ];
  }

  return [
    {
      number: 1,
      label: copy.flow.labels.loadTracks,
      status: hasTracks ? statusCopy.done : statusCopy.current,
      state: hasTracks ? "complete" : "current",
    },
    {
      number: 2,
      label: copy.flow.labels.confirmTracks,
      status: isClickReviewComplete
        ? statusCopy.done
        : hasTracks
          ? statusCopy.ready
          : statusCopy.locked,
      state: isClickReviewComplete
        ? "complete"
        : hasTracks
          ? "ready"
          : "locked",
    },
    {
      number: 3,
      label: copy.flow.labels.buildPlan,
      status: hasCandidates
        ? statusCopy.done
        : hasTracks
          ? statusCopy.ready
          : statusCopy.locked,
      state: hasCandidates ? "complete" : hasTracks ? "ready" : "locked",
    },
    {
      number: 4,
      label: copy.flow.labels.reviewPlan,
      status: hasSelection
        ? statusCopy.done
        : hasCandidates
          ? isPlanning
            ? statusCopy.current
            : statusCopy.ready
          : statusCopy.locked,
      state: hasSelection
        ? "complete"
        : hasCandidates
          ? isPlanning
            ? "current"
            : "ready"
          : "locked",
    },
    {
      number: 5,
      label: copy.flow.labels.export,
      status: hasExecutable
        ? statusCopy.ready
        : statusCopy.locked,
      state: hasExecutable ? "ready" : "locked",
    },
  ];
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

  if (error.kind === "noAudioFiles") {
    return copy.upload.noAudioFiles;
  }

  return error.message ?? copy.actions.planningError;
}

function createPlanningBpmCandidates(detectedBpm: number | null): BpmCandidate[] {
  if (detectedBpm === null || !Number.isFinite(detectedBpm)) {
    return [];
  }

  return getBpmCandidates(detectedBpm)
    .filter(
      (candidate) =>
        candidate.relation !== "1:2" && candidate.relation !== "2:3",
    )
    .map((candidate) => ({
      bpm: candidate.value,
      interpretation: candidate.relation,
    }));
}

function createTrackId(
  file: File,
  sourceKind: TrackSourceKind,
  index: number,
): string {
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${Date.now()}-${sourceKind}-${index}-${safeName}`;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function getAnalysisStageProgress(stage: AnalysisStage | "decoding"): number {
  const progress: Record<AnalysisStage | "decoding", number> = {
    decoding: 0.1,
    bpm: 0.28,
    click: 0.42,
    energy: 0.55,
    mood: 0.76,
    key: 0.9,
    structure: 0.98,
  };

  return progress[stage];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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
