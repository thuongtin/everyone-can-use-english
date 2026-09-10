import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { GradientCover } from "@renderer/components/enjoy";
import { NewspaperIcon } from "lucide-react";
import type { LocalStory } from "../../../types/local-study-api";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

export const StoryCard = (props: { story: LocalStory; className?: string }) => {
  const { story, className } = props;

  if (!story) {
    return null;
  }
  const imageUrl = displayableResourceUrl(story.metadata?.image);

  return (
    <Link
      to={`/stories/${story.id}`}
      className={cn(
        "group block w-full rounded-ej overflow-hidden",
        "border border-ej-line bg-ej-surface",
        "transition-all duration-ej hover:-translate-y-0.5 hover:shadow-ej",
        className
      )}
    >
      <GradientCover
        id={story.id}
        src={imageUrl}
        alt={story.title}
        rounded="rounded-none"
        className="aspect-[16/9] w-full"
      >
        {!imageUrl && <NewspaperIcon className="size-7" />}
      </GradientCover>

      <div className="h-16 px-3.5 py-2.5 overflow-hidden">
        <div className="text-[13px] font-semibold leading-[1.35] text-ej-ink line-clamp-2 group-hover:text-ej-accent-ink transition-colors duration-ej">
          {story.title}
        </div>
      </div>
    </Link>
  );
};
