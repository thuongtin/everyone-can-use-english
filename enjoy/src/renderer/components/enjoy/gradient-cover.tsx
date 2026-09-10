import { cn } from "@renderer/lib/utils";
import { gradientFor, initialsOf } from "@renderer/lib/design";
import { ImageOffIcon } from "lucide-react";
import { t } from "i18next";
import { resolveDisplayResource } from "@renderer/lib/retired-resource";

/**
 * Media cover. Falls back to the id-hashed gradient when there is no
 * thumbnail, matching the design's 8-gradient palette.
 */
export const GradientCover = (props: {
  id?: string;
  src?: string;
  alt?: string;
  className?: string;
  /** Icon or badge rendered centred on the gradient fallback. */
  children?: React.ReactNode;
  rounded?: string;
}) => {
  const { id, src, alt, className, children, rounded = "rounded-xl" } = props;
  const resource = resolveDisplayResource(src);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-ej-surface2 shrink-0",
        rounded,
        className
      )}
      style={resource.url ? undefined : { backgroundImage: gradientFor(id) }}
      data-retired-resource={resource.retired || undefined}
      title={resource.retired ? t("cannotFindSourceFile") : undefined}
    >
      {resource.url && (
        <img
          src={resource.url}
          alt={alt ?? ""}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      {resource.retired && (
        <div
          className="absolute inset-0 flex items-center justify-center text-white/90"
          role="img"
          aria-label={t("cannotFindSourceFile")}
        >
          <ImageOffIcon className="size-5" aria-hidden />
        </div>
      )}
      {children && !resource.retired && (
        <div className="absolute inset-0 flex items-center justify-center text-white/90">
          {children}
        </div>
      )}
    </div>
  );
};

/** Round gradient avatar with initials. Profile block, chats, assistants. */
export const GradientAvatar = (props: {
  name?: string;
  id?: string;
  size?: number;
  className?: string;
  square?: boolean;
}) => {
  const { name, id, size = 30, className, square } = props;

  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center font-bold text-white",
        square ? "rounded-[9px]" : "rounded-full",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size / 2.5)),
        backgroundImage: id
          ? gradientFor(id)
          : "linear-gradient(160deg, #2D6BE0, #7FB2FF)",
      }}
    >
      {initialsOf(name)}
    </div>
  );
};
