import { t } from "i18next";
import { toast } from "@renderer/components/ui";
import { LoaderSpin, PagePlaceholder, StoryToolbar, StoryViewer, StoryVocabularySheet } from "@renderer/components";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppSettingsProviderContext } from "@renderer/context";
import { useAiCommand } from "@renderer/hooks";
import nlp from "compromise";
import paragraphs from "compromise-paragraphs";
import type { LocalMeaning, LocalStory, LocalStudyExtraction, LocalStudyLookup } from "../../types/local-study-api";

nlp.plugin(paragraphs);

const pendingFor = (story: LocalStory | undefined, document: any, meanings: LocalMeaning[]): LocalStudyLookup[] => {
  if (!story?.extraction || !document) return [];
  const completed = new Set(meanings.map((meaning) => meaning.word.toLocaleLowerCase()));
  const pending = new Map<string, LocalStudyLookup>();
  for (const word of [...story.extraction.words, ...story.extraction.idioms]) {
    if (completed.has(word.toLocaleLowerCase())) continue;
    const sentences = document.lookup(word).sentences().json();
    for (const sentence of sentences) {
      const context = String(sentence.text || "").trim();
      if (!context) continue;
      pending.set(`${word.toLocaleLowerCase()}\n${context}`, { word, context, status: "pending" });
    }
  }
  return [...pending.values()];
};

export default () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<LocalStory>();
  const [meanings, setMeanings] = useState<LocalMeaning[]>([]);
  const [scanning, setScanning] = useState(false);
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [marked, setMarked] = useState(true);
  const [vocabularyVisible, setVocabularyVisible] = useState(false);
  const [lookingUpInBatch, setLookupInBatch] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const { lookupWord, extractStory } = useAiCommand();

  const document = useMemo(() => {
    if (!story?.content) return null;
    const parsed = nlp(story.content);
    parsed.cache();
    return parsed;
  }, [story?.content]);
  const pendingLookups = useMemo(() => pendingFor(story, document, meanings), [story, document, meanings]);

  const fetchStory = useCallback(async () => {
    try {
      const localStory = await EnjoyApp.localStudy.stories.get(id);
      setStory(localStory);
      setVocabularyVisible(!localStory.extracted);
    } catch {
      setStory(undefined);
    } finally {
      setLoading(false);
    }
  }, [EnjoyApp, id]);

  const fetchMeanings = useCallback(async () => {
    const response = await EnjoyApp.localStudy.meanings.list({ storyId: id, page: 1, items: 100 });
    setMeanings(response.meanings);
  }, [EnjoyApp, id]);

  const extractVocabulary = async () => {
    if (!story || scanning) return;
    setExtractionFailed(false);
    setScanning(true);
    try {
      const result = await extractStory(story as unknown as StoryType);
      const extraction = result as unknown as LocalStudyExtraction;
      if (!Array.isArray(extraction?.words) || !Array.isArray(extraction?.idioms)) {
        throw new Error("Provider returned an invalid vocabulary extraction");
      }
      setStory(await EnjoyApp.localStudy.stories.update(story.id, { extraction, extracted: true }));
      setVocabularyVisible(true);
      toast.success(t("extractedSuccessfully"), { position: "bottom-right" });
    } catch {
      setExtractionFailed(true);
      toast.error(t("extractionFailed"), { position: "bottom-right" });
    } finally {
      setScanning(false);
    }
  };

  const processLookup = useCallback(async (pendingLookup: LocalStudyLookup) => {
    if (lookingUp || !story) return;
    setLookingUp(true);
    await toast.promise(
      Promise.resolve(lookupWord({
        word: pendingLookup.word,
        context: pendingLookup.context,
        sourceId: story.id,
        sourceType: "Story",
      }))
        .then(async (lookup) => {
          if (!lookup?.meaning) throw new Error("Provider returned no meaning");
          await EnjoyApp.localStudy.meanings.upsert({ storyId: story.id, lookup: lookup as LocalStudyLookup });
          await fetchMeanings();
        })
        .finally(() => setLookingUp(false)),
      {
        loading: t("lookingUp"),
        success: t("lookedUpSuccessfully"),
        error: (error) => t("lookupFailed", { error: error.message }),
        position: "bottom-right",
      },
    );
  }, [EnjoyApp, fetchMeanings, lookingUp, lookupWord, story]);

  const toggleStarred = async () => {
    if (story) setStory(await EnjoyApp.localStudy.stories.setStarred(story.id, !story.starred));
  };
  const destroyStory = async () => {
    if (!story) return;
    await EnjoyApp.localStudy.stories.destroy(story.id);
    navigate("/stories");
  };

  useEffect(() => {
    void Promise.all([fetchStory(), fetchMeanings()]).catch((error) => {
      console.error(error);
      setLoading(false);
    });
  }, [fetchMeanings, fetchStory]);

  useEffect(() => {
    if (!lookingUpInBatch || lookingUp) return;
    if (!pendingLookups.length) {
      setLookupInBatch(false);
      return;
    }
    void processLookup(pendingLookups[0]);
  }, [lookingUp, lookingUpInBatch, pendingLookups, processLookup]);

  if (loading) return <div className="h-content w-full flex items-center justify-center bg-ej-bg"><LoaderSpin /></div>;
  if (!story) return <PagePlaceholder placeholder={t("notFound")} extra={`id=${id}`} showBackButton />;

  return (
    <>
      <div className="h-content w-full overflow-y-auto scroll bg-ej-bg">
        <StoryViewer
          story={story}
          marked={marked}
          pendingLookups={pendingLookups}
          meanings={meanings}
          setMeanings={setMeanings}
          doc={document}
          actions={<StoryToolbar
            marked={marked}
            toggleMarked={() => setMarked(!marked)}
            meanings={meanings}
            scanning={scanning}
            onScan={story.extracted ? () => setVocabularyVisible(true) : extractVocabulary}
            extracted={story.extracted}
            starred={story.starred}
            toggleStarred={() => void toggleStarred()}
            deleteStory={() => void destroyStory()}
            storyTitle={story.title}
            vocabularyVisible={vocabularyVisible}
            setVocabularyVisible={setVocabularyVisible}
          />}
        />
      </div>
      <StoryVocabularySheet
        pendingLookups={pendingLookups}
        extracted={story.extracted}
        scanning={scanning}
        extractionFailed={extractionFailed}
        onExtract={() => void extractVocabulary()}
        meanings={meanings}
        vocabularyVisible={vocabularyVisible}
        setVocabularyVisible={setVocabularyVisible}
        lookingUpInBatch={lookingUpInBatch}
        setLookupInBatch={setLookupInBatch}
        processLookup={(lookup) => void processLookup(lookup as LocalStudyLookup)}
        lookingUp={lookingUp}
      />
    </>
  );
};
