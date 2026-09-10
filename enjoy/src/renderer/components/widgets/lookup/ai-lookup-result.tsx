import { useEffect, useContext, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { Button, toast } from "@renderer/components/ui";
import { useAiCommand } from "@renderer/hooks";
import { LoaderIcon } from "lucide-react";
import { t } from "i18next";


export const AiLookupResult = (props: {
  word: string;
  context?: string;
  sourceType?: string;
  sourceId?: string;
}) => {
  const { word, context = "", sourceType, sourceId } = props;
  const { EnjoyApp, nativeLanguage, learningLanguage } = useContext(
    AppSettingsProviderContext
  );

  const [lookingUp, setLookingUp] = useState<boolean>(false);
  const [result, setResult] = useState<LookupType>();
  const { lookupWord, lookupCacheKey } = useAiCommand();

  const handleLookup = async (options?: { force: boolean }) => {
    if (lookingUp) return;
    if (!word) return;
    const { force = false } = options || {};

    setLookingUp(true);
    lookupWord({
      word,
      context,
      sourceId,
      sourceType,
      cacheKey: lookupCacheKey(word, context),
      force,
    })
      .then((lookup) => {
        if (lookup?.meaning) {
          setResult(lookup);
        }
      })
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setLookingUp(false);
      });
  };

  const fetchCachedLookup = async () => {
    const cacheKey = lookupCacheKey(word, context);
    const cached = await EnjoyApp.cacheObjects.get(
      cacheKey
    );
    if (cached?.meaning) {
      setResult(cached);
      return;
    }

    setResult(undefined);
  };

  /*
   * Fetch cached lookup result.
   */
  useEffect(() => {
    if (!word || !context) return;

    void fetchCachedLookup().catch(() => {
      setResult(undefined);
    });
  }, [word, context, nativeLanguage, learningLanguage, lookupCacheKey(word, context)]);

  if (!word) return null;

  return (
    <>
      {result ? (
        <>
          <div className="mb-4 select-text">
            <div className="mb-2 font-semibold font-sans">{word}</div>
            <div className="mb-2">
              {result.meaning?.pos && (
                <span className="mr-2 text-xs text-ej-muted">
                  {result.meaning.pos}
                </span>
              )}
              {result.meaning?.pronunciation && (
                <span className="text-sm font-code mr-2">
                  /{result.meaning.pronunciation.replaceAll("/", "")}/
                </span>
              )}
              {result.meaning?.lemma &&
                result.meaning.lemma !== result.meaning.word && (
                  <span className="text-sm">({result.meaning.lemma})</span>
                )}
            </div>
            <div className="font-sans">{result.meaning.translation}</div>
            <div className="font-sans">{result.meaning.definition}</div>
          </div>
          <div className="flex items-center">
            <Button
              className="cursor-pointer"
              variant="secondary"
              size="sm"
              disabled={lookingUp}
              onClick={() => handleLookup({ force: true })}
              asChild
            >
              <a>
                {lookingUp && (
                  <LoaderIcon className="animate-spin w-4 h-4 mr-2" />
                )}
                {t("reLookup")}
              </a>
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center space-x-2 py-2">
          <Button
            className="cursor-pointer"
            size="sm"
            asChild
            onClick={() => handleLookup()}
          >
            <a>
              {lookingUp && (
                <LoaderIcon className="animate-spin w-4 h-4 mr-2" />
              )}
              <span>{t("aiLookup")}</span>
            </a>
          </Button>
        </div>
      )}
    </>
  );
};
