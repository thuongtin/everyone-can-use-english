import { LoaderIcon } from "lucide-react";

export const LoaderSpin = () => {
  return (
    <div className="flex h-full w-full items-center justify-center px-7 py-[22px]">
      <LoaderIcon className="size-5 animate-spin text-ej-muted" />
    </div>
  );
};
