import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

export type DictionarySuggestion = {
  word: string;
  /** Short gloss shown at the right of the row. */
  note?: string;
  /** Pronunciation shown next to the word. */
  ipa?: string;
};

/**
 * Large search field of the dictionary screen: clear button, submit button and
 * a prefix dropdown. The dropdown closes on Escape and on an outside click.
 */
export const DictionarySearchBox = (props: {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  onPick: (word: string) => void;
  suggestions: DictionarySuggestion[];
  inputLabel: string;
  actionLabel: string;
  clearLabel: string;
  placeholder?: string;
}) => {
  const {
    value,
    onChange,
    onSearch,
    onPick,
    suggestions,
    inputLabel,
    actionLabel,
    clearLabel,
    placeholder,
  } = props;

  const [focused, setFocused] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const showSuggestions = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "flex h-12 items-center gap-2.5 rounded-[14px] border bg-ej-surface pl-3.5 pr-2 shadow-ej",
          "transition-colors duration-ej",
          focused ? "border-ej-accent" : "border-ej-line"
        )}
      >
        <SearchIcon className="size-4 shrink-0 text-ej-muted" />
        <input
          ref={inputRef}
          value={value}
          maxLength={200}
          aria-label={inputLabel}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setOpen(false);
              onSearch();
            }
            if (event.key === "Escape") setOpen(false);
          }}
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-ej-ink outline-none placeholder:text-ej-muted"
        />
        {value && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => {
              onChange("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onSearch();
          }}
          className="h-[34px] shrink-0 rounded-[9px] bg-ej-ink px-3.5 text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90"
        >
          {actionLabel}
        </button>
      </div>

      {showSuggestions && (
        <div className="absolute inset-x-0 top-[52px] z-20 animate-rise rounded-ej border border-ej-line bg-ej-surface p-1.5 shadow-ej">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.word}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(suggestion.word);
              }}
              className="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-ej hover:bg-ej-surface2"
            >
              <span className="min-w-0 truncate">
                <span className="text-xs font-semibold text-ej-ink">
                  {suggestion.word}
                </span>
                {suggestion.ipa && (
                  <span className="ml-1.5 font-ipa text-xs text-ej-muted">
                    {suggestion.ipa}
                  </span>
                )}
              </span>
              {suggestion.note && (
                <span className="shrink-0 text-xxs text-ej-muted">
                  {suggestion.note}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
