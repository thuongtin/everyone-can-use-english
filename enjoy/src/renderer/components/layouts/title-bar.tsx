import {
  AppSettingsProviderContext,
  CopilotProviderContext,
  LayoutProviderContext,
  ThemeProviderContext,
} from "@/renderer/context";
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogTrigger,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  toast,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { CommandPalette } from "./command-palette";
import { IpcRendererEvent } from "electron/renderer";
import { t } from "i18next";
import {
  ExternalLinkIcon,
  HelpCircleIcon,
  LightbulbIcon,
  MaximizeIcon,
  MinimizeIcon,
  MinusIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import type { LayoutPref } from "@renderer/context";

const LAYOUT_CYCLE: LayoutPref[] = ["auto", "fixed", "fluid"];

export const TitleBar = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [platform, setPlatform] = useState<"darwin" | "win32" | "linux">();
  const [updaterState, setUpdaterState] = useState<
    "checking-for-update" | "update-available" | "update-downloaded" | "error"
  >();
  const [quiting, setQuiting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const {
    EnjoyApp,
    distribution,
    version,
    setDisplayPreferences,
    initialized,
  } = useContext(AppSettingsProviderContext);
  const { active, setActive } = useContext(CopilotProviderContext);
  const { theme, colorScheme, setTheme } = useContext(ThemeProviderContext);
  const { layoutPref, setLayoutPref, fluid, fluidPending } = useContext(
    LayoutProviderContext
  );

  const layoutLabel = fluidPending
    ? "Fluid (chờ)"
    : layoutPref === "fixed"
      ? "Cố định"
      : layoutPref === "fluid"
        ? "Fluid"
        : fluid
          ? "Fluid · auto"
          : "Tự động";

  const checkUpdate = () => {
    if (!distribution.updateFeedUrl || platform === "linux") {
      EnjoyApp.shell.openExternal(distribution.downloadUrl);
      if (!distribution.updateFeedUrl) {
        toast.info(t("automaticUpdatesUnavailable"));
      }
    } else if (updaterState === "update-downloaded") {
      EnjoyApp.app.quitAndInstall();
    } else {
      EnjoyApp.app.checkForUpdates();
      toast.info(t("checkingForUpdate"));
    }
  };

  const onWindowChange = (
    _event: IpcRendererEvent,
    state: { event: string }
  ) => {
    if (state.event === "maximize") {
      setIsMaximized(true);
    } else if (state.event === "unmaximize") {
      setIsMaximized(false);
    } else if (state.event === "enter-full-screen") {
      setIsFullScreen(true);
    } else if (state.event === "leave-full-screen") {
      setIsFullScreen(false);
    }
  };

  const onUpdater = (
    _event: IpcRendererEvent,
    eventType:
      | "checking-for-update"
      | "update-available"
      | "update-downloaded"
      | "error"
  ) => {
    setUpdaterState(eventType);
    if (eventType === "update-available") {
      toast.info(t("updateAvailable"));
    } else if (eventType === "update-downloaded") {
      toast.success(t("updateDownloaded"));
    }
  };

  useEffect(() => {
    EnjoyApp.window.onChange(onWindowChange);
    EnjoyApp.app.getPlatformInfo().then((info) => {
      setPlatform(info.platform as "darwin" | "win32" | "linux");
    });
    EnjoyApp.app.onUpdater(onUpdater);

    return () => {
      EnjoyApp.window.removeListener(onWindowChange);
      EnjoyApp.app.removeUpdaterListeners();
    };
  }, []);

  useEffect(() => {
    if (quiting) {
      EnjoyApp.view.hide();
    } else {
      EnjoyApp.view.show();
    }
  }, [quiting]);

  // Global shell shortcuts: ⌘K opens the palette, ⌘J toggles the copilot aside.
  useEffect(() => {
    if (!initialized) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        setActive(!active);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [initialized, active]);

  useEffect(() => {
    if (paletteOpen) {
      EnjoyApp.view.hide();
    } else {
      EnjoyApp.view.show();
    }
  }, [paletteOpen]);

  return (
    <div className="z-[100] h-titlebar shrink-0 w-full bg-ej-side border-b border-ej-line draggable-region flex items-center gap-2 pl-2 pr-1">
      <div className="flex items-center gap-1 shrink-0">
        {platform === "darwin" && !isFullScreen && <div className="w-16" />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="non-draggable-region rounded-[5px] size-[18px] overflow-hidden shrink-0">
              <img src="./assets/icon.png" alt="Enjoy" className="size-full" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => EnjoyApp.app.reload()}
              className="cursor-pointer"
            >
              <span className="capitalize">{t("reloadApp")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => EnjoyApp.window.close()}
              className="cursor-pointer"
            >
              <span className="capitalize">{t("exit")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-[11px] font-bold tracking-[0.14em] text-ej-ink2 select-none ml-1.5">
          ENJOY
        </span>

        <span className="w-px h-4 bg-ej-line mx-1.5" />

        {initialized && (
          <EjIconButton
            className="non-draggable-region"
            title={t("sidebar.preferences")}
            onClick={() => setDisplayPreferences(true)}
          >
            <SettingsIcon className="size-4" />
          </EjIconButton>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EjIconButton className="non-draggable-region relative">
              <HelpCircleIcon className="size-4" />
              {updaterState && (
                <span className="absolute top-1 right-1 bg-ej-bad rounded-full size-1.5" />
              )}
            </EjIconButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() =>
                  EnjoyApp.shell.openExternal(distribution.docsUrl)
                }
                className="flex justify-between space-x-4"
              >
                <span className="min-w-fit capitalize">{t("userGuide")}</span>
                <ExternalLinkIcon className="size-4" />
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <span className="text-xs text-ej-muted">v{version}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={checkUpdate}
              className="cursor-pointer relative"
            >
              {updaterState && (
                <span className="absolute top-1 right-1 bg-ej-bad rounded-full size-1.5" />
              )}
              <span className="capitalize flex items-center gap-2">
                {!distribution.updateFeedUrl
                  ? t("automaticUpdatesUnavailable")
                  : updaterState === "checking-for-update"
                    ? t("checkingForUpdate")
                    : updaterState === "update-available"
                      ? t("updateAvailable")
                      : updaterState === "update-downloaded"
                        ? t("quitAndInstall")
                        : t("checkUpdate")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {initialized && (
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="non-draggable-region flex-[0_1_420px] mx-auto h-[26px] rounded-lg border border-ej-line bg-ej-surface hover:border-ej-line2 transition-colors duration-ej flex items-center gap-2 px-2.5 min-w-0"
        >
          <SearchIcon className="size-3.5 text-ej-muted shrink-0" />
          <span className="text-xs text-ej-muted truncate">
            Tìm kiếm hoặc nhảy tới…
          </span>
          <span className="flex-1" />
          <kbd className="text-xxs text-ej-muted border border-ej-line rounded px-1 shrink-0">
            ⌘K
          </kbd>
        </button>
      )}

      <div className="flex items-center gap-1 shrink-0 ml-auto">
        {initialized && (
          <>
            <EjIconButton
              className="non-draggable-region"
              title={colorScheme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
              onClick={() =>
                setTheme(
                  theme === "dark"
                    ? "light"
                    : theme === "light"
                      ? "dark"
                      : colorScheme === "dark"
                        ? "light"
                        : "dark"
                )
              }
            >
              {colorScheme === "dark" ? (
                <SunIcon className="size-4" />
              ) : (
                <MoonIcon className="size-4" />
              )}
            </EjIconButton>

            <button
              type="button"
              title="Bố cục"
              onClick={() =>
                setLayoutPref(
                  LAYOUT_CYCLE[
                    (LAYOUT_CYCLE.indexOf(layoutPref) + 1) % LAYOUT_CYCLE.length
                  ]
                )
              }
              className={`non-draggable-region h-7 px-2 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors duration-ej ${
                fluid
                  ? "bg-ej-accent-soft text-ej-accent-ink"
                  : "text-ej-ink2 hover:bg-ej-surface2"
              }`}
            >
              {fluid ? (
                <MaximizeIcon className="size-3.5" />
              ) : (
                <MinimizeIcon className="size-3.5" />
              )}
              <span className="whitespace-nowrap">{layoutLabel}</span>
            </button>

            <EjIconButton
              className="non-draggable-region"
              title="Trợ lý bên cạnh (⌘J)"
              active={active}
              onClick={() => setActive(!active)}
            >
              <LightbulbIcon className="size-4" />
            </EjIconButton>
          </>
        )}

        {platform !== "darwin" && (
          <>
            <span className="w-px h-4 bg-ej-line mx-1" />
            <div className="flex items-center gap-0.5">
              <EjIconButton
                className="non-draggable-region"
                onClick={() => EnjoyApp.window.minimize()}
              >
                <MinusIcon className="size-4" />
              </EjIconButton>
              <EjIconButton
                className="non-draggable-region"
                onClick={() => EnjoyApp.window.toggleMaximized()}
              >
                {isMaximized ? (
                  <MinimizeIcon className="size-4" />
                ) : (
                  <MaximizeIcon className="size-4" />
                )}
              </EjIconButton>
              <AlertDialog open={quiting} onOpenChange={setQuiting}>
                <AlertDialogTrigger asChild>
                  <EjIconButton className="non-draggable-region" danger>
                    <XIcon className="size-4" />
                  </EjIconButton>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("quitApp")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("quitAppDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-ej-bad text-white hover:opacity-90"
                      onClick={() => {
                        setQuiting(false);
                        EnjoyApp.window.close();
                      }}
                    >
                      {t("quit")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </div>

      {initialized && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      )}
    </div>
  );
};
