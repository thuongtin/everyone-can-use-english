import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import { cn } from "@renderer/lib/utils";
import { t } from "i18next";
import {
  captionIpas,
  isLexical,
  scoreTone,
  WEAK_SCORE,
} from "./caption-words";

const UNDERLINE_COLOR: Record<string, string> = {
  warn: "var(--ej-warn)",
  bad: "var(--ej-bad)",
};

/**
 * The sentence itself: one column per word, the phonetics sitting under it and
 * the practice marks drawn from the selected recording.
 */
export const MediaCaption = (props: {
  caption: TimelineEntry;
  words: string[];
  language?: string;
  selectedIndices?: number[];
  currentSegmentIndex: number;
  activeIndex?: number;
  displayIpa?: boolean;
  wordScores?: Map<number, number>;
  notedIndices?: number[];
  onWordClick?: (index: number, element: HTMLElement) => void;
}) => {
  const { learningLanguage, ipaMappings } = useContext(
    AppSettingsProviderContext
  );
  const {
    caption,
    words,
    selectedIndices = [],
    currentSegmentIndex,
    activeIndex,
    displayIpa,
    wordScores,
    notedIndices = [],
    onWordClick,
  } = props;
  const language = props.language || learningLanguage;

  const ipas = captionIpas(caption, language, ipaMappings);

  return (
    <div className="flex flex-wrap items-start gap-x-px gap-y-2 px-5 pb-3.5 pt-5">
      {words.map((word, index) => {
        const clickable = isLexical(word);
        const playing = index === activeIndex;
        const selected = selectedIndices.includes(index);
        const score = wordScores?.get(index);
        const weak = typeof score === "number" && score < WEAK_SCORE;
        const tone = weak ? scoreTone(score) : null;

        return (
          <div
            key={`word-${currentSegmentIndex}-${index}`}
            id={`word-${currentSegmentIndex}-${index}`}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            data-tooltip-id={weak ? "media-shadow-tooltip" : undefined}
            data-tooltip-content={
              weak ? t("segment.weakWordTooltip", { score }) : undefined
            }
            onClick={(event) =>
              clickable && onWordClick?.(index, event.currentTarget)
            }
            className={cn(
              "relative flex flex-col items-center rounded-lg px-[5px] py-0.5",
              "transition-colors duration-ej",
              clickable && "cursor-pointer hover:bg-ej-accent-soft",
              playing && "bg-ej-hl",
              selected && "bg-ej-accent-soft"
            )}
          >
            <span
              className={cn(
                "font-literata text-[19px] leading-[1.3]",
                playing
                  ? "font-semibold text-ej-hl-ink"
                  : selected
                    ? "text-ej-accent-ink"
                    : "text-ej-ink"
              )}
              style={
                weak
                  ? {
                      textDecoration: "underline",
                      textDecorationThickness: "2px",
                      textDecorationColor: UNDERLINE_COLOR[tone],
                      textUnderlineOffset: "4px",
                      textDecorationSkipInk: "none",
                    }
                  : undefined
              }
            >
              {word}
            </span>

            {displayIpa && ipas[index] && (
              <span
                className={cn(
                  "mt-0.5 select-text font-ipa text-[11.5px] leading-[1.3]",
                  playing
                    ? "font-semibold text-ej-hl-ink"
                    : selected
                      ? "text-ej-accent-ink"
                      : "text-ej-muted"
                )}
              >
                {ipas[index]}
              </span>
            )}

            {notedIndices.includes(index) && (
              <span className="absolute right-0 top-[3px] size-[5px] rounded-full bg-ej-accent" />
            )}
          </div>
        );
      })}
    </div>
  );
};
