import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileAudio,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  MousePointerClick,
  Trash2,
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
import type { TrackAudioMap, TrackFileMap } from "../audio/multiTrackTypes";
import { renderExecutableMixPlan } from "../audio/renderExecutableMixPlan";
import {
  createStandardizedBpmCandidates,
  createTrackImportKey,
  getSupportedAudioFiles,
  getTrackRelativePath,
  parseStandardizedTrackCadence,
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
  getLockedSelectionKey,
  mergeLockedSelections,
  moveSelection,
  replaceSelection,
  summarizeSelectionPlan,
} from "../planning/editSelectionPlan";
import { formatPercent } from "../utils/format";
import { CandidateScoreTable } from "./CandidateScoreTable";
import { ExecutableMixPlanView } from "./ExecutableMixPlanView";
import { MixTrackListView } from "./MixTrackListView";
import { RunningPlanSelector } from "./RunningPlanSelector";
import { TrackFeatureTable } from "./TrackFeatureTable";
import { LibraryCoveragePanel } from "./LibraryCoveragePanel";
import { PlanVariantPicker } from "./PlanVariantPicker";
import { MixPlanEditor } from "./MixPlanEditor";
import {
  getLocalizedPlanTitle,
  type MultiTrackCopy,
} from "./multiTrackFormat";
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
  maxTracksPerSegment: 4,
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
  | { kind: "processing"; current: number; total: number; fileName: string }
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
  | { kind: "invalidStandardizedNames"; count: number }
  | { kind: "planning"; message: string | null };

type PlannerRunState = "ready" | "running" | "complete" | "failed";
type PlannerEngine = "auto" | "gpt" | "local";
type PlannerResultSource = "gpt" | "local" | "local-fallback" | null;

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
  const importRequestIdRef = useRef(0);
  const [currentStep, setCurrentStep] = useState(1);
  const [activeImportSource, setActiveImportSource] =
    useState<TrackSourceKind>("standardized");
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
  const [clickSettings, setClickSettings] = useState<MetronomePreference>(
    DEFAULT_MULTI_TRACK_CLICK_SETTINGS,
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [plannerEngine, setPlannerEngine] = useState<PlannerEngine>("auto");
  const [plannerResultSource, setPlannerResultSource] =
    useState<PlannerResultSource>(null);
  const [sequenceRules, setSequenceRules] = useState<GlobalSequenceRules>(
    DEFAULT_SEQUENCE_RULES,
  );
  const [planVariants, setPlanVariants] = useState<MixPlanVariant[]>([]);
  const [activeVariantId, setActiveVariantId] =
    useState<MixPlanStrategy>("balanced");
  const [lockedSelectionKeys, setLockedSelectionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<AnalysisMessage | null>(
    null,
  );
  const [error, setError] = useState<PlannerError | null>(null);
  const [renderedMixBuffer, setRenderedMixBuffer] = useState<AudioBuffer | null>(
    null,
  );
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      importRequestIdRef.current += 1;
      try {
        renderedPlaybackSourceRef.current?.stop();
      } catch {
        // Preview may already have ended.
      }
      void audioContextRef.current?.close();
    };
  }, []);

  const selectedPlan = useMemo<RunningPlan>(
    () => buildRunningPlanFromSettings(planSettings),
    [planSettings],
  );
  const localizedPlanTitle = useMemo(
    () => getLocalizedPlanTitle(copy.runningPlan, selectedPlan),
    [copy.runningPlan, selectedPlan],
  );
  const libraryStats = useMemo(() => {
    const cadences = tracks.flatMap((track) =>
      track.bpmCandidates.map((candidate) => candidate.bpm),
    );
    const cadenceRange =
      cadences.length > 0
        ? `${Math.min(...cadences).toFixed(0)}–${Math.max(...cadences).toFixed(0)} BPM`
        : "--";

    return {
      total: tracks.length,
      finished: tracks.filter((track) => track.sourceKind === "standardized").length,
      raw: tracks.filter((track) => track.sourceKind === "raw").length,
      cadenceRange,
    };
  }, [tracks]);
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
    candidateGroups.length > 0 &&
    candidateGroups.every((group) => group.topCandidates.length > 0) &&
    !isPlanning &&
    !isApplyingPlan;
  const hasTracks = tracks.length > 0;
  const hasCandidates = candidateGroups !== null;
  const missingCandidateCount =
    candidateGroups?.filter((group) => group.topCandidates.length === 0).length ?? 0;
  const coverageReport = useMemo(
    () =>
      candidateGroups
        ? analyzeLibraryCoverage({
            runningPlan: selectedPlan,
            tracks,
            candidateGroups,
          })
        : null,
    [candidateGroups, selectedPlan, tracks],
  );
  const hasSelection = selectionPlan !== null;
  const hasExecutable = executablePlan !== null;
  const plannerRunState = getPlannerRunState({
    error,
    hasSelection,
    isPlanning: isPlanning || isApplyingPlan,
  });
  const plannerStatusCopy = copy.actions.plannerStates[plannerRunState];
  const flowSteps = useMemo(
    () =>
      getMultiTrackFlowSteps({
        hasTracks,
        hasCandidates,
        hasSelection,
        hasExecutable,
        isPlanning: isPlanning || isApplyingPlan,
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
      isApplyingPlan,
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
    isPlanning: isPlanning || isApplyingPlan,
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
    setSelectedTrackAudioMap({});
    setPlannerResultSource(null);
    setPlanVariants([]);
    setActiveVariantId("balanced");
    setLockedSelectionKeys(new Set());
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

  const handleFilesSelect = async (
    files: FileList | null,
    sourceKind: TrackSourceKind,
  ) => {
    const supportedFiles = getSupportedAudioFiles(Array.from(files ?? []));

    if (supportedFiles.length === 0) {
      setError({ kind: "noAudioFiles" });
      return;
    }

    const existingImportKeys = new Set(tracks.map((track) => track.importKey));
    let duplicateCount = 0;
    let invalidNameCount = 0;
    const importEntries = supportedFiles.flatMap((file) => {
      const importKey = createTrackImportKey(file, sourceKind);

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
        invalidNames: invalidNameCount,
      });
      setError(
        invalidNameCount > 0
          ? { kind: "invalidStandardizedNames", count: invalidNameCount }
          : null,
      );
      return;
    }

    setCurrentStep(1);
    setIsAnalyzing(true);
    setAnalysisMessage({ kind: "preparing", count: importEntries.length });
    setError(null);
    resetPlanningOutput();

    const importedTracks: TrackFeature[] = [];
    const nextTrackFileMap: TrackFileMap = {};
    let failures = 0;
    const requestId = ++importRequestIdRef.current;

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
        });

        try {
          const embeddedMetadata =
            sourceKind === "standardized"
              ? await readRunTempoWavMetadata(file)
              : null;
          const embeddedCadenceBpm =
            sourceKind === "standardized"
              ? embeddedMetadata?.cadenceBpm ??
                parseStandardizedTrackCadence(file.name)
              : null;

          if (sourceKind === "standardized" && embeddedCadenceBpm === null) {
            invalidNameCount += 1;
            continue;
          }

          const decoded = await withTimeout(
            decodeAudioFile(file, audioContext),
            30000,
            DECODE_TIMEOUT_ERROR,
          );

          await new Promise((resolve) => window.requestAnimationFrame(resolve));

          const detectedBpm =
            sourceKind === "standardized"
              ? embeddedCadenceBpm
              : await detectPlanningBpm(decoded.audioBuffer);
          const trackId = createTrackId(file, sourceKind, index);

          nextTrackFileMap[trackId] = file;

          importedTracks.push({
            trackId,
            importKey,
            fileName: decoded.fileName,
            relativePath: relativePath === file.name ? null : relativePath,
            sourceKind,
            embeddedCadenceBpm,
            durationSec: decoded.durationSec,
            detectedBpm,
            bpmCandidates:
              sourceKind === "standardized" && embeddedCadenceBpm !== null
                ? createStandardizedBpmCandidates(embeddedCadenceBpm)
                : createPlanningBpmCandidates(detectedBpm),
            beatConfidence: sourceKind === "standardized" ? 1 : null,
            tempoStability: sourceKind === "standardized" ? 1 : null,
            rawEnergyFeatures:
              embeddedMetadata?.rawEnergyFeatures ??
              extractRawEnergyFeatures(decoded.audioBuffer),
            energyFeatureSource: embeddedMetadata?.rawEnergyFeatures
              ? "embedded"
              : "analyzed",
            normalizedEnergyScore: null,
          });
        } catch {
          failures += 1;
        }
      }

      const nextTracks = normalizeTrackEnergy([...tracks, ...importedTracks]);
      setTracks(nextTracks);
      setTrackFileMap((current) => ({ ...current, ...nextTrackFileMap }));
      setAnalysisMessage({
        kind: "imported",
        added: importedTracks.length,
        total: nextTracks.length,
        duplicates: duplicateCount,
        invalidNames: invalidNameCount,
      });

      if (failures > 0) {
        setError({ kind: "decodeFailures", count: failures });
      } else if (invalidNameCount > 0) {
        setError({
          kind: "invalidStandardizedNames",
          count: invalidNameCount,
        });
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

  const buildLoadedExecutablePlan = async (
    nextSelectionPlan: OpenAISelectionPlan,
  ) => {
    const baseExecutablePlan = applyClickSettingsToPlan(
      buildExecutableMixPlan({
        runningPlan: selectedPlan,
        tracks,
        selectionPlan: nextSelectionPlan,
        crossfadeSec: DEFAULT_CROSSFADE_SEC,
        allowLoop: true,
      }),
      clickSettings,
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

  const handleGenerateMixPlan = async (): Promise<boolean> => {
    if (!candidateGroups || !canGenerate) {
      return false;
    }

    setIsPlanning(true);
    setError(null);

    try {
      const plannerInput = {
        runningPlan: selectedPlan,
        tracks,
        topCandidatesBySegment: candidateGroups,
        rules: {
          allowTrackReuse: true,
          allowLoop: true,
          maxTracksPerSegment: sequenceRules.maxTracksPerSegment,
          preferStableCadenceGrid: true,
          minRepeatGapTracks: sequenceRules.minRepeatGapTracks,
          preferFolderVariety: sequenceRules.preferFolderVariety,
        },
      };
      let nextSelectionPlan: OpenAISelectionPlan;
      let nextPlannerSource: PlannerResultSource;

      if (plannerEngine === "local") {
        nextSelectionPlan = await new MockMixPlannerClient().createSelectionPlan(
          plannerInput,
        );
        nextPlannerSource = "local";
      } else if (plannerEngine === "gpt") {
        nextSelectionPlan = await new HttpMixPlannerClient(
          PLANNER_API_BASE_URL,
        ).createSelectionPlan(plannerInput);
        nextPlannerSource = "gpt";
      } else {
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
          nextPlannerSource = "local-fallback";
        }
      }

      const nextVariants = createMixPlanVariants({
        runningPlan: selectedPlan,
        tracks,
        candidateGroups,
        rules: sequenceRules,
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

      setPlanVariants(nextVariants);
      setActiveVariantId(balancedVariant.variantId);
      setLockedSelectionKeys(new Set());
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

  const handleSequenceRulesChange = (rules: GlobalSequenceRules) => {
    setSequenceRules(rules);
    setPlanVariants([]);
    setSelectionPlan(null);
    setExecutablePlan(null);
    setSelectedTrackAudioMap({});
    setLockedSelectionKeys(new Set());
    setPlannerResultSource(null);
    resetRenderedOutput();
  };

  const handleSelectVariant = async (variantId: MixPlanStrategy) => {
    const variant = planVariants.find((item) => item.variantId === variantId);

    if (!variant || isApplyingPlan || isPlanning) {
      return;
    }

    const nextSelectionPlan = selectionPlan
      ? mergeLockedSelections({
          targetPlan: variant.selectionPlan,
          currentPlan: selectionPlan,
          lockedSelectionKeys,
        })
      : variant.selectionPlan;

    setActiveVariantId(variantId);
    await applySelectionPlan(nextSelectionPlan, variantId);
  };

  const handleToggleSelectionLock = (segmentId: string, trackId: string) => {
    const key = getLockedSelectionKey(segmentId, trackId);
    setLockedSelectionKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  const handleReplaceSelection = async (
    segmentId: string,
    index: number,
    trackId: string,
  ) => {
    if (!selectionPlan) {
      return;
    }

    const candidate = candidateGroups
      ?.find((group) => group.segmentId === segmentId)
      ?.topCandidates.find((item) => item.trackId === trackId);

    if (!candidate) {
      return;
    }

    await applySelectionPlan(
      replaceSelection(selectionPlan, segmentId, index, candidate),
    );
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
        trackAudioMap: selectedTrackAudioMap,
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

                <div
                  className="source-tabs"
                  role="tablist"
                  aria-label={copy.upload.sourceAria}
                >
                  <button
                    id="standardized-library-tab"
                    type="button"
                    role="tab"
                    aria-selected={activeImportSource === "standardized"}
                    aria-controls="standardized-library-panel"
                    className={
                      activeImportSource === "standardized" ? "active" : ""
                    }
                    onClick={() => setActiveImportSource("standardized")}
                  >
                    <span className="source-tab-icon local" aria-hidden="true">
                      <FolderOpen size={19} />
                    </span>
                    <span>
                      <strong className="source-tab-title-row">
                        {copy.upload.standardizedTab}
                        <span className="source-tab-recommendation">
                          {copy.upload.standardizedKicker}
                        </span>
                      </strong>
                      <small>{copy.upload.standardizedTabHint}</small>
                    </span>
                  </button>
                  <button
                    id="raw-library-tab"
                    type="button"
                    role="tab"
                    aria-selected={activeImportSource === "raw"}
                    aria-controls="raw-library-panel"
                    className={activeImportSource === "raw" ? "active" : ""}
                    onClick={() => setActiveImportSource("raw")}
                  >
                    <span className="source-tab-icon local" aria-hidden="true">
                      <HardDrive size={19} />
                    </span>
                    <span>
                      <strong>{copy.upload.rawTab}</strong>
                      <small>{copy.upload.rawTabHint}</small>
                    </span>
                  </button>
                </div>

                {activeImportSource === "standardized" ? (
                  <div
                    id="standardized-library-panel"
                    className="source-workspace multi-library-source-workspace"
                    role="tabpanel"
                    aria-labelledby="standardized-library-tab"
                  >
                    <div className="source-method-intro">
                      <div>
                        <span className="source-method-kicker">
                          {copy.upload.standardizedKicker}
                        </span>
                        <h3>{copy.upload.standardizedTitle}</h3>
                        <p>{copy.upload.standardizedHint}</p>
                      </div>
                    </div>
                    <label className="drop-zone compact-drop-zone multi-drop-zone">
                      <input
                        {...DIRECTORY_INPUT_PROPS}
                        type="file"
                        multiple
                        accept="audio/*,.mp3,.wav,.m4a,.aac"
                        disabled={isAnalyzing}
                        onChange={(event) => {
                          void handleFilesSelect(
                            event.target.files,
                            "standardized",
                          );
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
                    </label>
                  </div>
                ) : (
                  <div
                    id="raw-library-panel"
                    className="source-workspace multi-library-source-workspace"
                    role="tabpanel"
                    aria-labelledby="raw-library-tab"
                  >
                    <div className="source-method-intro">
                      <div>
                        <span className="source-method-kicker">
                          {copy.upload.rawKicker}
                        </span>
                        <h3>{copy.upload.rawTitle}</h3>
                        <p>{copy.upload.rawHint}</p>
                      </div>
                    </div>
                    <label className="drop-zone compact-drop-zone multi-drop-zone">
                      <input
                        type="file"
                        multiple
                        accept="audio/*,.mp3,.wav,.m4a,.aac"
                        disabled={isAnalyzing}
                        onChange={(event) => {
                          void handleFilesSelect(event.target.files, "raw");
                          event.currentTarget.value = "";
                        }}
                      />
                      <span className="drop-icon">
                        <Upload size={24} aria-hidden="true" />
                      </span>
                      <span className="drop-copy">
                        <strong>{copy.upload.chooseFiles}</strong>
                        <small>{copy.upload.rawFileHint}</small>
                      </span>
                    </label>
                    <div className="format-row" aria-label={copy.upload.formatsAria}>
                      <span>MP3</span>
                      <span>WAV</span>
                      <span>M4A</span>
                      <span>AAC</span>
                    </div>
                  </div>
                )}

                <div className="multi-library-footer">
                  <div className="library-import-footer">
                    <p className="field-hint">{copy.upload.hint}</p>
                    {tracks.length > 0 ? (
                      <button
                        type="button"
                        className="secondary-action clear-library-action"
                        disabled={isAnalyzing}
                        onClick={handleClearLibrary}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {copy.upload.clearLibrary}
                      </button>
                    ) : null}
                  </div>

                  {analysisMessageText ? (
                    <p className="planner-status">{analysisMessageText}</p>
                  ) : null}
                  {errorText ? <p className="error-text">{errorText}</p> : null}
                </div>

                {tracks.length > 0 ? (
                  <dl className="summary-grid multi-library-summary">
                    <div><dt>{copy.upload.librarySummary.total}</dt><dd>{libraryStats.total}</dd></div>
                    <div><dt>{copy.upload.librarySummary.finished}</dt><dd>{libraryStats.finished}</dd></div>
                    <div><dt>{copy.upload.librarySummary.raw}</dt><dd>{libraryStats.raw}</dd></div>
                    <div><dt>{copy.upload.librarySummary.cadenceRange}</dt><dd>{libraryStats.cadenceRange}</dd></div>
                    <div><dt>{copy.upload.librarySummary.memory}</dt><dd>{copy.upload.librarySummary.onDemand}</dd></div>
                  </dl>
                ) : null}
              </section>

              {tracks.length > 0 ? (
                <TrackFeatureTable
                  tracks={tracks}
                  copy={copy.tracks}
                  onRemove={handleRemoveTrack}
                />
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
              {coverageReport ? (
                <LibraryCoveragePanel
                  report={coverageReport}
                  copy={copy.coverage}
                />
              ) : null}
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
                    <span>{copy.actions.plannerModeLabel}</span>
                    <strong>
                      {plannerResultSource === "gpt"
                        ? copy.actions.plannerResult.gpt
                        : plannerResultSource === "local"
                          ? copy.actions.plannerResult.local
                          : plannerResultSource === "local-fallback"
                            ? copy.actions.plannerResult.localFallback
                            : plannerEngine === "local"
                              ? copy.actions.localPlanner
                              : plannerStatusCopy.title}
                    </strong>
                    <p>
                      {plannerEngine === "auto"
                        ? copy.actions.autoPlannerHint
                        : plannerEngine === "local"
                          ? copy.actions.localPlannerHint
                          : copy.actions.openaiPlannerHint}
                    </p>
                  </div>
                </div>
                <div className="planner-engine-grid" role="radiogroup" aria-label={copy.actions.plannerModeLabel}>
                  {(["auto", "gpt", "local"] as const).map((engine) => (
                    <button
                      key={engine}
                      type="button"
                      role="radio"
                      aria-checked={plannerEngine === engine}
                      className={plannerEngine === engine ? "active" : ""}
                      disabled={isPlanning}
                      onClick={() => {
                        setPlannerEngine(engine);
                        setPlannerResultSource(null);
                        setSelectionPlan(null);
                        setExecutablePlan(null);
                        setSelectedTrackAudioMap({});
                        resetRenderedOutput();
                      }}
                    >
                      {engine === "auto"
                        ? copy.actions.autoPlanner
                        : engine === "gpt"
                          ? copy.actions.openaiPlanner
                          : copy.actions.localPlanner}
                    </button>
                  ))}
                </div>
                <div className="sequence-rule-panel" aria-labelledby="sequence-rules-title">
                  <div className="sequence-rule-heading">
                    <strong id="sequence-rules-title">{copy.actions.sequenceRules.title}</strong>
                    <small>{copy.actions.sequenceRules.hint}</small>
                  </div>
                  <label className="sequence-rule-field">
                    <span>{copy.actions.sequenceRules.repeatGap}</span>
                    <input
                      type="range"
                      min="0"
                      max="8"
                      step="1"
                      value={sequenceRules.minRepeatGapTracks}
                      disabled={isPlanning}
                      onChange={(event) =>
                        handleSequenceRulesChange({
                          ...sequenceRules,
                          minRepeatGapTracks: Number(event.target.value),
                        })
                      }
                    />
                    <output>{copy.actions.sequenceRules.tracks(sequenceRules.minRepeatGapTracks)}</output>
                  </label>
                  <label className="sequence-rule-field">
                    <span>{copy.actions.sequenceRules.segmentTracks}</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="1"
                      value={sequenceRules.maxTracksPerSegment}
                      disabled={isPlanning}
                      onChange={(event) =>
                        handleSequenceRulesChange({
                          ...sequenceRules,
                          maxTracksPerSegment: Number(event.target.value),
                        })
                      }
                    />
                    <output>{sequenceRules.maxTracksPerSegment}</output>
                  </label>
                  <label className="sequence-rule-toggle">
                    <input
                      type="checkbox"
                      checked={sequenceRules.preferFolderVariety}
                      disabled={isPlanning}
                      onChange={(event) =>
                        handleSequenceRulesChange({
                          ...sequenceRules,
                          preferFolderVariety: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>{copy.actions.sequenceRules.folderVariety}</strong>
                      <small>{copy.actions.sequenceRules.folderVarietyHint}</small>
                    </span>
                  </label>
                </div>
                <p className={`candidate-coverage ${missingCandidateCount > 0 ? "warning" : "ready"}`}>
                  {missingCandidateCount > 0
                    ? copy.candidates.coverageMissing(missingCandidateCount)
                    : copy.candidates.coverageReady}
                </p>
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
              {planVariants.length > 0 ? (
                <PlanVariantPicker
                  variants={planVariants}
                  activeVariantId={activeVariantId}
                  isBusy={isApplyingPlan || isPlanning}
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
                  tracks={tracks}
                  candidateGroups={candidateGroups}
                  lockedSelectionKeys={lockedSelectionKeys}
                  isBusy={isApplyingPlan || isPlanning}
                  copy={copy.editor}
                  segmentNames={copy.runningPlan.segmentNames}
                  onToggleLock={handleToggleSelectionLock}
                  onReplace={(segmentId, index, trackId) => {
                    void handleReplaceSelection(segmentId, index, trackId);
                  }}
                  onMove={(segmentId, fromIndex, toIndex) => {
                    void handleMoveSelection(segmentId, fromIndex, toIndex);
                  }}
                />
              ) : null}
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
                generatedClickBlockCount={executablePlan.blocks.filter(
                  (block) => block.metronome.enabled,
                ).length}
                embeddedClickBlockCount={executablePlan.blocks.filter(
                  (block) => !block.metronome.enabled,
                ).length}
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
  generatedClickBlockCount,
  embeddedClickBlockCount,
  onChange,
}: {
  settings: MetronomePreference;
  copy: MultiTrackCopy["click"];
  generatedClickBlockCount: number;
  embeddedClickBlockCount: number;
  onChange: (settings: MetronomePreference) => void;
}) {
  const hasGeneratedClick = generatedClickBlockCount > 0;

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
          <dd>
            {hasGeneratedClick
              ? copy.generatedBlocks(generatedClickBlockCount)
              : copy.summary.embeddedOnly}
          </dd>
        </div>
        <div>
          <dt>{copy.summary.style}</dt>
          <dd>
            {hasGeneratedClick
              ? copy.clickStyleLabels[settings.clickStyle]
              : copy.summary.fromSource}
          </dd>
        </div>
        <div>
          <dt>{copy.summary.accent}</dt>
          <dd>
            {hasGeneratedClick
              ? copy.everyAccent(settings.accentEvery)
              : copy.summary.fromSource}
          </dd>
        </div>
        <div>
          <dt>{copy.summary.sync}</dt>
          <dd>
            {hasGeneratedClick
              ? copy.summary.automaticSync
              : copy.summary.alreadyAligned}
          </dd>
        </div>
        <div>
          <dt>{copy.summary.volume}</dt>
          <dd>
            {hasGeneratedClick
              ? formatPercent(settings.clickVolume)
              : copy.summary.fromSource}
          </dd>
        </div>
      </dl>

      {embeddedClickBlockCount > 0 ? (
        <p className="planner-status">
          {copy.embeddedBlocks(embeddedClickBlockCount)}
        </p>
      ) : null}

      {hasGeneratedClick ? (
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
      ) : null}
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

  if (message.kind === "processing") {
    return copy.processingFile(message.current, message.total, message.fileName);
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

  if (error.kind === "noAudioFiles") {
    return copy.upload.noAudioFiles;
  }

  if (error.kind === "invalidStandardizedNames") {
    return copy.upload.invalidStandardizedNames(error.count);
  }

  return error.message ?? copy.actions.planningError;
}

async function detectPlanningBpm(
  audioBuffer: AudioBuffer,
): Promise<number | null> {
  const analysis = await analyzeBpm(audioBuffer);
  return analysis.bpm ? normalizeBpm(analysis.bpm) : null;
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

function createTrackId(
  file: File,
  sourceKind: TrackSourceKind,
  index: number,
): string {
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${Date.now()}-${sourceKind}-${index}-${safeName}`;
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
