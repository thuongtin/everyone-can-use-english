import { Outlet } from "react-router-dom";
import {
  AppSettingsProviderContext,
  CopilotProviderContext,
  LayoutProviderContext,
} from "@renderer/context";
import { useContext, useState } from "react";
import { CopilotSession, TitleBar, Sidebar } from "@renderer/components";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@renderer/components/ui";

/** Design width of the copilot aside, mirrored by `--ej-aside-w`. */
const ASIDE_WIDTH = 340;

export const Layout = () => {
  const { initialized } = useContext(AppSettingsProviderContext);
  const { active, setActive } = useContext(CopilotProviderContext);
  const { windowWidth } = useContext(LayoutProviderContext);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // react-resizable-panels works in percentages, so translate the design's
  // fixed 340px aside into one for the current window width.
  const asidePercent = Math.min(
    50,
    Math.max(15, Math.round((ASIDE_WIDTH / Math.max(windowWidth, 1)) * 100))
  );

  if (initialized) {
    return (
      <div className="h-screen flex flex-col bg-ej-bg">
        <TitleBar />
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1 h-full w-full"
          data-testid="layout-home"
        >
          <ResizablePanel id="main-panel" order={1} minSize={50}>
            <div className="flex flex-start w-full">
              <Sidebar
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
              />
              <div
                id="main-panel-content"
                className="flex-1 min-w-0 h-content overflow-hidden relative"
              >
                <div className="overflow-x-hidden overflow-y-auto w-full h-content">
                  <Outlet />
                </div>
              </div>
            </div>
          </ResizablePanel>
          {active && (
            <>
              <ResizableHandle className="bg-ej-line" />
              <ResizablePanel
                id="copilot-panel"
                order={2}
                collapsible={true}
                defaultSize={asidePercent}
                maxSize={50}
                minSize={15}
                onCollapse={() => setActive(false)}
              >
                <div className="h-content bg-ej-surface border-l border-ej-line">
                  <CopilotSession />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    );
  } else {
    return (
      <div className="h-screen flex flex-col w-full bg-ej-bg">
        <TitleBar />
        <div className="flex-1 h-content overflow-y-auto">
          <Outlet />
        </div>
      </div>
    );
  }
};
