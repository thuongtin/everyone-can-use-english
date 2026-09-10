import { MediaShadowProviderContext } from "@renderer/context";
import {
  MediaLoadingModal,
  MediaRightPanel,
  MediaLeftPanel,
  MediaBottomPanel,
  MediaHeader,
  MediaRecordings,
} from "@renderer/components";
import { t } from "i18next";
import { useContext, useState } from "react";

export const MediaShadowPlayer = () => {
  return (
    <>
      <div className="h-full flex flex-col min-h-0 bg-ej-bg">
        <MediaHeader />

        <div className="flex-1 min-h-0">
          <TopPanel />
        </div>

        <MediaBottomPanel />
      </div>
      <MediaLoadingModal />
    </>
  );
};

const TopPanel = () => {
  const { layout } = useContext(MediaShadowProviderContext);
  const [displayPanel, setDisplayPanel] = useState<"left" | "right" | null>(
    "right"
  );

  if (layout === "normal") {
    return (
      <div className="h-full min-h-0 grid grid-cols-[1fr_1fr] fluid:grid-cols-[1.05fr_1.1fr_300px]">
        <div className="min-w-0 min-h-0 border-r border-ej-line bg-ej-surface">
          <MediaLeftPanel />
        </div>

        <div className="min-w-0 min-h-0 bg-ej-surface fluid:border-r fluid:border-ej-line">
          <MediaRightPanel />
        </div>

        <aside className="hidden fluid:flex flex-col min-w-0 min-h-0 bg-ej-side">
          <div className="ej-label px-4 py-3 border-b border-ej-line shrink-0">
            {t("myRecordings")}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll">
            <MediaRecordings />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0">
      <MediaLeftPanel
        className={displayPanel === "left" ? "flex-1" : "invisible fixed"}
        setDisplayPanel={setDisplayPanel}
      />
      <MediaRightPanel
        className={displayPanel === "right" ? "flex-1" : "invisible fixed"}
        setDisplayPanel={setDisplayPanel}
      />
    </div>
  );
};
