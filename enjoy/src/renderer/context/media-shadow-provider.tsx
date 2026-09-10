import {
  createContext,
  useEffect,
  useState,
  useContext,
  useMemo,
  useRef,
} from "react";
import { convertIpaToNormal, extractFrequencies } from "@/utils";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  useTranscriptions,
  useRecordings,
  useSegments,
  useNotes,
} from "@renderer/hooks";
import WaveSurfer from "wavesurfer.js";
import Regions, {
  type Region as RegionType,
} from "wavesurfer.js/dist/plugins/regions";
import Chart from "chart.js/auto";
import {
  Timeline,
  TimelineEntry,
} from "echogarden/dist/utilities/Timeline.d.js";
import { toast } from "@renderer/components/ui";
import { Tooltip } from "react-tooltip";
import { useAudioRecorder } from "react-audio-voice-recorder";
import { t } from "i18next";
import { SttEngineOptionEnum } from "@/types/enums";
import { useNavigate } from "react-router-dom";
import {
  isValidMediaWaveformCache,
  publishPreparedMediaWaveform,
  resolveMediaWaveformCache,
  resolveMediaWaveformDuration,
  startMediaWaveformLifecycle,
} from "@renderer/lib/media-waveform-lifecycle";

const ONE_MINUTE = 60;
const TEN_MINUTES = 10 * ONE_MINUTE;

type MediaShadowContextType = {
  layout: "compact" | "normal";
  onCancel: () => void;
  media: AudioType | VideoType;
  setMedia: (media: AudioType | VideoType) => void;
  setMediaProvider: (mediaProvider: HTMLAudioElement | null) => void;
  waveform: WaveFormDataType;
  // wavesurfer
  wavesurfer: WaveSurfer;
  setWaveformContainerRef: (ref: any) => void;
  decoded: boolean;
  decodeError: string;
  setDecodeError: (error: string) => void;
  // player state
  currentTime: number;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (index: number) => void;
  zoomRatio: number;
  setZoomRatio: (zoomRation: number) => void;
  fitZoomRatio: number;
  minPxPerSec: number;
  // regions
  regions: Regions | null;
  activeRegion: RegionType;
  setActiveRegion: (region: RegionType) => void;
  toggleRegion: (params: number[]) => void;
  renderPitchContour: (
    region: RegionType,
    options?: {
      repaint?: boolean;
      canvasId?: string;
      containerClassNames?: string[];
      data?: Chart["data"];
    }
  ) => void;
  editingRegion: boolean;
  setEditingRegion: (editing: boolean) => void;
  pitchChart: Chart;
  // Transcription
  transcription: TranscriptionType;
  generateTranscription: (params?: {
    originalText?: string;
    language?: string;
    model?: string;
    service?: SttEngineOptionEnum | "upload";
    isolate?: boolean;
  }) => Promise<void>;
  transcribing: boolean;
  committing: boolean;
  transcribingProgress: number;
  transcribingOutput: string;
  abortGenerateTranscription: () => void;
  transcriptionDraft: TranscriptionType["result"];
  setTranscriptionDraft: (result: TranscriptionType["result"]) => void;
  caption: TimelineEntry;
  // Recordings
  startRecording: () => void;
  cancelPendingRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  togglePauseResume: () => void;
  recordingBlob: Blob;
  isRecording: boolean;
  isPaused: boolean;
  recordingType: string;
  setRecordingType: (type: string) => void;
  recordingTime: number;
  mediaRecorder: MediaRecorder;
  currentRecording: RecordingType;
  setCurrentRecording: (recording: RecordingType) => void;
  recordings: RecordingType[];
  fetchRecordings: (offset: number) => void;
  loadingRecordings: boolean;
  // Notes
  currentNotes: NoteType[];
  createNote: (params: any) => void;
  // Segments
  currentSegment: SegmentType;
  createSegment: () => Promise<SegmentType | void>;
  getCachedSegmentIndex: () => Promise<number>;
  setCachedSegmentIndex: (index: number) => void;
};

export type MicrophoneRecordingIntentOptions = {
  requestAccess: () => Promise<boolean>;
  startRecording: () => void;
  getScope: () => string | null;
  onDenied: () => void;
  onError: (error: unknown) => void;
};

export const createMicrophoneRecordingIntent = ({
  requestAccess,
  startRecording,
  getScope,
  onDenied,
  onError,
}: MicrophoneRecordingIntentOptions) => {
  let generation = 0;
  let activeGeneration = 0;
  let phase: "idle" | "requesting" | "starting" | "recording" = "idle";

  const requestStart = async () => {
    if (phase !== "idle") return;

    const scope = getScope();
    if (!scope) return;

    const requestGeneration = generation;
    phase = "requesting";

    try {
      const access = await requestAccess();
      if (requestGeneration !== generation || scope !== getScope()) return;

      if (!access) {
        phase = "idle";
        onDenied();
        return;
      }

      phase = "starting";
      activeGeneration = requestGeneration;
      startRecording();
    } catch (error) {
      if (requestGeneration !== generation || scope !== getScope()) return;
      phase = "idle";
      onError(error);
    }
  };

  return {
    requestStart,
    invalidate: () => {
      generation += 1;
      phase = "idle";
    },
    recorderRejected: (error: unknown) => {
      if (activeGeneration !== generation) return;
      phase = "idle";
      onError(error);
    },
    syncRecordingState: (isRecording: boolean) => {
      if (isRecording) {
        phase = "recording";
      } else if (phase === "recording") {
        phase = "idle";
      }
    },
  };
};

export const MediaShadowProviderContext =
  createContext<MediaShadowContextType>(null);

export const MediaShadowProvider = ({
  children,
  layout = "normal",
  onCancel,
}: {
  children: React.ReactNode;
  layout?: "compact" | "normal";
  onCancel?: () => void;
}) => {
  const minPxPerSec = 150;
  const { EnjoyApp, learningLanguage, recorderConfig } = useContext(
    AppSettingsProviderContext
  );
  const navigate = useNavigate();

  const [media, setMedia] = useState<AudioType | VideoType>(null);
  const [mediaProvider, setMediaProvider] = useState<HTMLAudioElement | null>(
    null
  );
  const [waveform, setWaveForm] = useState<WaveFormDataType>(null);
  const [waveformLoadedFor, setWaveformLoadedFor] = useState<string | null>(null);
  const waveformLookupRevisionRef = useRef(0);
  const wavesurferRevisionRef = useRef(0);
  const [wavesurfer, setWavesurfer] = useState(null);

  const [regions, setRegions] = useState<Regions | null>(null);
  const [activeRegion, setActiveRegion] = useState<RegionType>(null);
  const [editingRegion, setEditingRegion] = useState<boolean>(false);
  const [pitchChart, setPitchChart] = useState<Chart>(null);

  const [waveformContainerRef, setWaveformContainerRef] = useState(null);

  //  Player state
  const [decoded, setDecoded] = useState<boolean>(false);
  const [decodeError, setDecodeError] = useState<string>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(0);
  const [fitZoomRatio, setFitZoomRatio] = useState<number>(1.0);
  const [zoomRatio, setZoomRatio] = useState<number>(1.0);

  const [currentRecording, setCurrentRecording] = useState<RecordingType>(null);
  const [recordingType, setRecordingType] = useState<string>("segment");
  const [cancelingRecording, setCancelingRecording] = useState(false);
  const mediaScopeRef = useRef<string | null>(null);
  const recorderStartRef = useRef<() => void>(() => {});
  const recordingIntentRef = useRef<
    ReturnType<typeof createMicrophoneRecordingIntent>
  >();

  mediaScopeRef.current = media
    ? `${media.mediaType}:${String(media.id)}`
    : null;

  if (!recordingIntentRef.current) {
    recordingIntentRef.current = createMicrophoneRecordingIntent({
      requestAccess: () =>
        EnjoyApp.system.preferences.mediaAccess("microphone"),
      startRecording: () => recorderStartRef.current(),
      getScope: () => mediaScopeRef.current,
      onDenied: () => toast.warning(t("noMicrophoneAccess")),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : t("noMicrophoneAccess")
        ),
    });
  }

  const [transcriptionDraft, setTranscriptionDraft] =
    useState<TranscriptionType["result"]>();

  const {
    transcription,
    generateTranscription,
    transcribing,
    committing,
    transcribingProgress,
    transcribingOutput,
    abortGenerateTranscription,
  } = useTranscriptions(media);

  const cancelRecording = () => {
    setCancelingRecording(true);
  };

  const {
    recordings,
    fetchRecordings,
    loading: loadingRecordings,
  } = useRecordings(media, currentSegmentIndex);

  const {
    startRecording: startAudioRecorder,
    stopRecording,
    togglePauseResume,
    recordingBlob,
    isRecording,
    isPaused,
    recordingTime,
    mediaRecorder,
  } = useAudioRecorder(recorderConfig, (exception) => {
    recordingIntentRef.current?.recorderRejected(exception);
  });
  recorderStartRef.current = startAudioRecorder;

  const startRecording = () => {
    void recordingIntentRef.current?.requestStart();
  };
  const cancelPendingRecording = () => {
    recordingIntentRef.current?.invalidate();
  };

  const caption = useMemo(() => {
    return (transcription?.result?.timeline as Timeline)?.[currentSegmentIndex];
  }, [currentSegmentIndex, transcription]);

  const { segment, createSegment } = useSegments({
    targetId: media?.id,
    targetType: media?.mediaType,
    segmentIndex: currentSegmentIndex,
  });

  const getCachedSegmentIndex = async () => {
    if (!media) return;

    const cachedId = `${media.mediaType.toLowerCase()}-${
      media.id
    }-last-segment-index`;
    const index = await EnjoyApp.cacheObjects.get(cachedId);

    return index || 0;
  };

  const setCachedSegmentIndex = (index: number) => {
    if (!media) return;

    const cachedId = `${media.mediaType.toLowerCase()}-${
      media.id
    }-last-segment-index`;
    return EnjoyApp.cacheObjects.set(cachedId, index);
  };

  const { notes, createNote } = useNotes({
    targetId: segment?.id,
    targetType: "Segment",
  });

  const renderPitchContour = (
    region: RegionType,
    options?: {
      repaint?: boolean;
      canvasId?: string;
      containerClassNames?: string[];
      data?: Chart["data"];
    }
  ) => {
    if (!region) return;
    if (!waveform?.frequencies?.length) return;
    if (!wavesurfer) return;
    if (!waveformContainerRef?.current) return;

    const caption = transcription?.result?.timeline?.[currentSegmentIndex];
    if (!caption) return;

    const { repaint = true, containerClassNames = [] } = options || {};
    const duration = wavesurfer.getDuration();
    const fromIndex = Math.round(
      (region.start / duration) * waveform.frequencies.length
    );
    const toIndex = Math.round(
      (region.end / duration) * waveform.frequencies.length
    );

    const wrapper = (wavesurfer as any).renderer.getWrapper();
    if (!wrapper) return;

    // remove existing pitch contour
    if (repaint) {
      wrapper
        .querySelectorAll(".pitch-contour")
        .forEach((element: HTMLDivElement) => {
          element.remove();
        });
    }

    // calculate offset and width
    const wrapperWidth = wrapper.getBoundingClientRect().width;
    const height = waveformContainerRef.current.getBoundingClientRect().height;
    const offsetLeft = (region.start / duration) * wrapperWidth;
    const width = ((region.end - region.start) / duration) * wrapperWidth;

    // create container and canvas
    const pitchContourWidthContainer = document.createElement("div");
    const canvas = document.createElement("canvas");
    const canvasId = options?.canvasId || `pitch-contour-${region.id}-canvas`;
    canvas.id = canvasId;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    pitchContourWidthContainer.appendChild(canvas);

    pitchContourWidthContainer.style.position = "absolute";
    pitchContourWidthContainer.style.top = "0";
    pitchContourWidthContainer.style.left = "0";

    pitchContourWidthContainer.style.width = `${width}px`;
    pitchContourWidthContainer.style.height = `${height}px`;
    pitchContourWidthContainer.style.marginLeft = `${offsetLeft}px`;
    pitchContourWidthContainer.classList.add(
      "pitch-contour",
      ...containerClassNames
    );
    // pitchContourWidthContainer.style.zIndex = "3";

    wrapper.appendChild(pitchContourWidthContainer);

    // prepare chart data
    let chartData: Chart["data"] = options?.data;

    if (!chartData) {
      const data = waveform.frequencies.slice(fromIndex, toIndex);
      const regionDuration = region.end - region.start;

      const labels = new Array(data.length).fill("");
      if (region.id.startsWith("segment-region")) {
        caption.timeline.forEach((segment: TimelineEntry) => {
          const index = Math.round(
            ((segment.startTime - region.start) / regionDuration) * data.length
          );
          labels[index] = segment.text.trim();
        });
      } else if (region.id.startsWith("meaning-group-region")) {
        const words = caption.timeline.filter(
          (w: TimelineEntry) =>
            w.startTime >= region.start &&
            w.endTime <= region.end &&
            w.type === "word"
        );
        words.forEach((word: TimelineEntry) => {
          const index = Math.round(
            ((word.startTime - region.start) / regionDuration) * data.length
          );
          labels[index] = word.text.trim();
        });
      } else if (region.id.startsWith("word-region")) {
        const words = caption.timeline.filter(
          (w: TimelineEntry) =>
            w.startTime >= region.start &&
            w.endTime <= region.end &&
            w.type === "word"
        );

        let phones: TimelineEntry[] = [];
        words.forEach((word: TimelineEntry) => {
          word.timeline?.forEach((token: TimelineEntry) => {
            phones = phones.concat(token.timeline);
          });
        });

        phones.forEach((phone: TimelineEntry) => {
          const index = Math.round(
            ((phone.startTime - region.start) / regionDuration) * data.length
          );
          labels[index] = [
            labels[index] || "",
            (media?.language || learningLanguage).startsWith("en")
              ? convertIpaToNormal(phone.text.trim())
              : phone.text.trim(),
          ].join("");
        });
      }

      chartData = {
        labels,
        datasets: [
          {
            data,
            cubicInterpolationMode: "monotone",
          },
        ],
      };
    }

    setPitchChart(
      new Chart(canvas, {
        type: "line",
        data: chartData,
        options: {
          plugins: {
            legend: {
              display: false,
            },
            title: {
              display: false,
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: {
                autoSkip: false,
              },
              display: true,
              grid: {
                display: false,
              },
              border: {
                display: false,
              },
            },
            y: {
              beginAtZero: true,
              display: false,
            },
          },
        },
      })
    );
  };

  const onRecorded = async (blob: Blob) => {
    if (cancelingRecording) {
      setCancelingRecording(false);
      return;
    }
    if (!blob) return;
    if (!media) return;
    if (!transcription?.result?.timeline) return;

    let referenceId = -1;
    let referenceText = transcription.result.timeline
      .map((s: TimelineEntry) => s.text)
      .join("\n");

    if (recordingType === "segment") {
      const currentSegment =
        transcription?.result?.timeline?.[currentSegmentIndex];
      if (!currentSegment) return;

      referenceId = currentSegmentIndex;
      referenceText = currentSegment.text;
    }

    EnjoyApp.recordings
      .create({
        targetId: media.id,
        targetType: media.mediaType,
        blob: {
          type: recordingBlob.type.split(";")[0],
          arrayBuffer: await blob.arrayBuffer(),
        },
        referenceId,
        referenceText,
      })
      .then(() =>
        toast.success(t("recordingSaved"), { position: "bottom-right" })
      )
      .catch((err) =>
        toast.error(t("failedToSaveRecording" + " : " + err.message))
      );
  };

  const toggleRegion = (params: number[]) => {
    if (!activeRegion) return;
    if (editingRegion) {
      toast.warning(t("currentRegionIsBeingEdited"));
      return;
    }
    if (params.length === 0) {
      if (activeRegion.id.startsWith("word-region")) {
        activeRegion.remove();
        setActiveRegion(
          regions.getRegions().find((r) => r.id.startsWith("segment-region"))
        );
      }
      return;
    }

    const startIndex = Math.min(...params);
    const endIndex = Math.max(...params);

    const startWord = caption.timeline[startIndex];
    if (!startWord) return;

    const endWord = caption.timeline[endIndex] || startWord;

    const start = startWord.startTime;
    const end = endWord.endTime;

    // If the active region is a word region, then merge the selected words into a single region.
    if (activeRegion.id.startsWith("word-region")) {
      activeRegion.remove();

      const region = regions.addRegion({
        id: `word-region-${startIndex}`,
        start,
        end,
        color: "#fb6f9233",
        drag: false,
        resize: editingRegion,
      });

      setActiveRegion(region);
      // If the active region is a meaning group region, then active the segment region.
    } else if (activeRegion.id.startsWith("meaning-group-region")) {
      setActiveRegion(
        regions.getRegions().find((r) => r.id.startsWith("segment-region"))
      );
      // If the active region is a segment region, then create a new word region.
    } else {
      const region = regions.addRegion({
        id: `word-region-${startIndex}`,
        start,
        end,
        color: "#fb6f9233",
        drag: false,
        resize: false,
      });

      setActiveRegion(region);
    }
  };

  /*
   * update fitZoomRatio when currentSegmentIndex is updated
   */
  useEffect(() => {
    if (!waveformContainerRef?.current) return;
    if (!wavesurfer) return;

    if (!activeRegion) return;

    const containerWidth =
      waveformContainerRef.current.getBoundingClientRect().width;
    const duration = activeRegion.end - activeRegion.start;
    if (activeRegion.id.startsWith("word-region")) {
      setFitZoomRatio(containerWidth / 3 / duration / minPxPerSec);
    } else {
      setFitZoomRatio(containerWidth / duration / minPxPerSec);
    }

    return () => {
      setFitZoomRatio(1.0);
    };
  }, [waveformContainerRef, wavesurfer, activeRegion]);

  /*
   * Zoom chart when zoomRatio update
   */
  useEffect(() => {
    if (!wavesurfer) return;
    if (!decoded) return;

    wavesurfer.zoom(zoomRatio * minPxPerSec);
    if (!activeRegion) return;

    renderPitchContour(activeRegion);
    wavesurfer.setScrollTime(activeRegion.start);
  }, [zoomRatio, wavesurfer, decoded]);

  /*
   * Re-render pitch contour when active region changed
   */
  useEffect(() => {
    if (!activeRegion) return;
    if (!wavesurfer) return;

    renderPitchContour(activeRegion);
  }, [wavesurfer, activeRegion]);

  /*
   * Update player styles
   */
  useEffect(() => {
    if (!wavesurfer) return;
    if (!decoded) return;

    const scrollContainer = wavesurfer.getWrapper().closest(".scroll");
    scrollContainer.style.scrollbarWidth = "thin";
  }, [decoded, wavesurfer]);

  useEffect(() => {
    const md5 = media?.md5;
    const source = media?.src;
    const revision = waveformLookupRevisionRef.current + 1;
    waveformLookupRevisionRef.current = revision;
    setWaveForm(null);
    setWaveformLoadedFor(null);
    setDecoded(false);
    setDecodeError(null);
    if (!md5 || !source) return;

    const abortController = new AbortController();
    const isCurrent = () =>
      !abortController.signal.aborted &&
      waveformLookupRevisionRef.current === revision;
    const finish = (nextWaveform: WaveFormDataType) => {
      if (!isCurrent()) return;
      setWaveForm(nextWaveform);
      setWaveformLoadedFor(md5);
    };

    const lookup = resolveMediaWaveformCache({
      load: () => EnjoyApp.waveforms.find(md5),
      isCurrent,
      onResolved: (cachedWaveform) => {
        if (isValidMediaWaveformCache(cachedWaveform)) {
          finish(cachedWaveform);
          return;
        }

        void (async () => {
          let audioContext: AudioContext | undefined;
          try {
            const response = await fetch(source, {
              signal: abortController.signal,
            });
            if (!response.ok) {
              throw new Error(`Failed to fetch audio: ${response.status}`);
            }
            const bytes = await response.arrayBuffer();
            if (!isCurrent()) return;
            audioContext = new AudioContext({ sampleRate: 8_000 });
            const decodedData = await audioContext.decodeAudioData(bytes);
            if (!isCurrent()) return;
            const peaks = decodedData.getChannelData(0);
            const nextWaveform = {
              peaks: Array.from(peaks),
              duration: decodedData.duration,
              sampleRate: decodedData.sampleRate,
              frequencies: extractFrequencies({
                peaks,
                sampleRate: decodedData.sampleRate,
              }),
            };
            void publishPreparedMediaWaveform({
              value: nextWaveform,
              isCurrent,
              publish: finish,
              save: value => EnjoyApp.waveforms.save(md5, value),
            });
          } catch (error) {
            if (!isCurrent()) return;
            const message =
              error instanceof Error
                ? error.message
                : "Error occurred while decoding audio";
            setDecodeError(message);
          } finally {
            void audioContext?.close().catch((): void => undefined);
          }
        })();
      },
    });

    return () => {
      abortController.abort();
      lookup.dispose();
      if (waveformLookupRevisionRef.current === revision) {
        waveformLookupRevisionRef.current += 1;
      }
    };
  }, [media?.md5, media?.src]);

  /*
   * Initialize wavesurfer when container ref is available
   * and mediaProvider is available
   */
  useEffect(() => {
    if (!media?.src || !media?.md5) return;
    if (waveformLoadedFor !== media.md5) return;
    if (!mediaProvider || !waveformContainerRef?.current) return;

    const container = waveformContainerRef.current.querySelector(
      ".waveform-container"
    );
    if (!container) return;

    const revision = wavesurferRevisionRef.current + 1;
    wavesurferRevisionRef.current = revision;
    let ready = false;
    setDecoded(false);
    setDecodeError(null);
    setCurrentTime(0);

    const lifecycle = startMediaWaveformLifecycle({
      create: () => WaveSurfer.create({
        container: container as HTMLElement,
        height:
          waveformContainerRef.current.getBoundingClientRect().height - 10,
        waveColor: "#eaeaea",
        progressColor: "#c0d6df",
        cursorColor: "#ff0054",
        barWidth: 2,
        autoScroll: true,
        minPxPerSec,
        autoCenter: false,
        dragToSeek: false,
        fillParent: true,
        media: mediaProvider,
        peaks: waveform ? [waveform.peaks] : undefined,
        // The custom enjoy:// media element can report a non-finite duration
        // after metadata has already fired. Supplying the DB metadata duration
        // prevents WaveSurfer from waiting for that event a second time. It
        // still emits ready only after the prepared peaks are rendered.
        duration: resolveMediaWaveformDuration(
          waveform?.duration,
          media.duration
        ),
      }),
      isCurrent: () => wavesurferRevisionRef.current === revision,
      // The preparation effect owns the only fetch/decode pipeline. WaveSurfer
      // receives prepared peaks, so its deferred constructor load only renders
      // them. The lifecycle installs listeners before that microtask.
      load: () => {},
      onTimeUpdate: (time) =>
        setCurrentTime(Math.ceil(time * 100) / 100),
      onReady: () => {
        ready = true;
        setDecoded(true);
      },
      onError: (error) => {
        const message = error?.message || "Error occurred while decoding audio";
        toast.error(message);
        setDecodeError(message);
        if (ready) window.location.reload();
      },
    });

    const instance = lifecycle.instance;
    setWavesurfer(instance);
    setRegions(instance.registerPlugin(Regions.create()));

    return () => {
      if (wavesurferRevisionRef.current === revision) {
        wavesurferRevisionRef.current += 1;
      }
      lifecycle.dispose();
      setWavesurfer((current: WaveSurfer | null) =>
        current === instance ? null : current
      );
      setRegions(null);
      setDecoded(false);
      setDecodeError(null);
    };
  }, [
    media?.src,
    media?.md5,
    mediaProvider,
    waveformContainerRef,
    waveformLoadedFor,
  ]);

  /* cache last segment index */
  useEffect(() => {
    if (!media) return;
    if (typeof currentSegmentIndex !== "number") return;

    setCachedSegmentIndex(currentSegmentIndex);
  }, [currentSegmentIndex]);

  /*
   * Abort transcription when component is unmounted
   */
  useEffect(() => {
    return () => {
      abortGenerateTranscription();
    };
  }, []);

  /**
   * create recording when recordingBlob is updated
   */
  useEffect(() => {
    onRecorded(recordingBlob);
  }, [recordingBlob]);

  useEffect(() => {
    if (cancelingRecording) {
      stopRecording();
    }
  }, [cancelingRecording]);

  useEffect(() => {
    recordingIntentRef.current?.syncRecordingState(isRecording);
  }, [isRecording]);

  useEffect(() => {
    return () => recordingIntentRef.current?.invalidate();
  }, [media?.mediaType, media?.id]);

  /**
   * auto stop recording when recording time is over
   */
  useEffect(() => {
    if (!isRecording) return;

    if (recordingType === "segment" && recordingTime >= ONE_MINUTE) {
      stopRecording();
    } else if (recordingTime >= TEN_MINUTES) {
      stopRecording();
    }
  }, [recordingTime, recordingType]);

  return (
    <>
      <MediaShadowProviderContext.Provider
        value={{
          layout,
          onCancel: onCancel || (() => navigate(-1)),
          media,
          setMedia,
          setMediaProvider,
          wavesurfer,
          setWaveformContainerRef,
          decoded,
          decodeError,
          setDecodeError,
          currentTime,
          currentSegmentIndex,
          setCurrentSegmentIndex,
          waveform,
          zoomRatio,
          setZoomRatio,
          fitZoomRatio,
          minPxPerSec,
          transcription,
          regions,
          pitchChart,
          activeRegion,
          setActiveRegion,
          toggleRegion,
          renderPitchContour,
          editingRegion,
          setEditingRegion,
          generateTranscription,
          transcribing,
          committing,
          transcribingProgress,
          transcribingOutput,
          abortGenerateTranscription,
          transcriptionDraft,
          setTranscriptionDraft,
          caption,
          startRecording,
          cancelPendingRecording,
          stopRecording,
          cancelRecording,
          togglePauseResume,
          recordingBlob,
          isRecording,
          isPaused,
          recordingType,
          setRecordingType,
          recordingTime,
          mediaRecorder,
          currentRecording,
          setCurrentRecording,
          recordings,
          fetchRecordings,
          loadingRecordings,
          currentNotes: notes,
          createNote,
          currentSegment: segment,
          createSegment,
          getCachedSegmentIndex,
          setCachedSegmentIndex,
        }}
      >
        {children}
      </MediaShadowProviderContext.Provider>
      <Tooltip className="z-10" id="media-shadow-tooltip" />
    </>
  );
};
