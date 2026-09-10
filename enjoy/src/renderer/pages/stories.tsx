import { Button } from "@renderer/components/ui";
import { StoryForm, StoryCard, LoaderSpin } from "@renderer/components";
import {
  EjEmptyState,
  EjMediaGrid,
  EjPage,
  EjPageHeader,
} from "@renderer/components/enjoy";
import { useState, useContext, useEffect } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { t } from "i18next";
import type { LocalStory } from "../../types/local-study-api";

export default () => {
  const [stories, setStories] = useState<LocalStory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [nextPage, setNextPage] = useState(1);

  const fetchStories = async (page: number = nextPage) => {
    if (!page) return;

    EnjoyApp.localStudy.stories
      .list({ page, items: 20 })
      .then((response) => {
        if (response?.stories) {
          setStories((current) => page === 1
            ? response.stories
            : [...current, ...response.stories]);
        }
        setNextPage(response.next);
      })
      .finally(() => {
        setLoading(false);
      })
      .catch((error) => {
        setLoading(false);
        setNextPage(null);
        console.error(error);
      });
  };

  useEffect(() => {
    fetchStories();
  }, [EnjoyApp]);

  return (
    <EjPage>
      <EjPageHeader
        title={t("library.stories")}
        description={t("library.storiesDescription")}
      />

      <div className="mb-6">
        <StoryForm />
      </div>

      {loading ? (
        <LoaderSpin />
      ) : stories.length === 0 ? (
        <EjEmptyState
          title={t("library.empty")}
          description={t("library.emptyDescription")}
        />
      ) : (
        <EjMediaGrid wide>
          {stories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </EjMediaGrid>
      )}

      {nextPage && stories.length > 0 && (
        <div className="flex items-center justify-center mt-6">
          <Button variant="link" onClick={() => fetchStories(nextPage)}>
            {t("loadMore")}
          </Button>
        </div>
      )}
    </EjPage>
  );
};
