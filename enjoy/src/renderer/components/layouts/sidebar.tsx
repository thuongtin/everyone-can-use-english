import {
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import {
  SettingsIcon,
  HomeIcon,
  HeadphonesIcon,
  VideoIcon,
  NewspaperIcon,
  BookMarkedIcon,
  BookOpenIcon,
  BotIcon,
  LanguagesIcon,
  LucideIcon,
  NotebookPenIcon,
  SpeechIcon,
  MessagesSquareIcon,
  PanelLeftOpenIcon,
  PanelLeftCloseIcon,
  ChevronsUpDownIcon,
  LibraryBigIcon,
  UserIcon,
  RepeatIcon,
} from "lucide-react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { t } from "i18next";
import { Preferences } from "@renderer/components";
import { GradientAvatar } from "@renderer/components/enjoy";
import {
  AppSettingsProviderContext,
  LayoutProviderContext,
} from "@renderer/context";
import { useContext, useEffect } from "react";
import { cn } from "@renderer/lib/utils";

type NavEntry = {
  href: string;
  label: string;
  Icon: LucideIcon;
  testid?: string;
  /** Exact match instead of prefix match, for routes that are prefixes of others. */
  exact?: boolean;
};

type NavGroup = {
  label?: string;
  items: NavEntry[];
};

const navGroups = (): NavGroup[] => [
  {
    items: [
      { href: "/", label: t("sidebar.home"), Icon: HomeIcon, exact: true },
      { href: "/chats", label: t("sidebar.chats"), Icon: MessagesSquareIcon },
    ],
  },
  {
    label: t("sidebar.groupLearn"),
    items: [
      { href: "/audios", label: t("sidebar.audios"), Icon: HeadphonesIcon },
      { href: "/videos", label: t("sidebar.videos"), Icon: VideoIcon },
      { href: "/documents", label: t("sidebar.documents"), Icon: NewspaperIcon },
      { href: "/stories", label: t("sidebar.stories"), Icon: BookOpenIcon },
      {
        href: "/learning-studio",
        label: t("sidebar.learningStudio"),
        Icon: LibraryBigIcon,
        testid: "sidebar-learning-studio",
      },
    ],
  },
  {
    label: t("sidebar.groupPractice"),
    items: [
      {
        href: "/conversations",
        label: t("sidebar.aiAssistant"),
        Icon: BotIcon,
        testid: "sidebar-conversations",
      },
      {
        href: "/pronunciation_assessments",
        label: t("sidebar.pronunciationAssessment"),
        Icon: SpeechIcon,
        testid: "sidebar-pronunciation-assessments",
      },
      {
        href: "/vocabulary",
        label: t("sidebar.vocabulary"),
        Icon: BookMarkedIcon,
      },
      { href: "/notes", label: t("sidebar.notes"), Icon: NotebookPenIcon },
      {
        href: "/dictionary",
        label: t("sidebar.dictionary"),
        Icon: LanguagesIcon,
      },
    ],
  },
];

export const Sidebar = (props: {
  isCollapsed: boolean;
  setIsCollapsed: (isCollapsed: boolean) => void;
}) => {
  const { setIsCollapsed } = props;
  const location = useLocation();
  const activeTab = location.pathname;
  const { EnjoyApp, displayPreferences, setDisplayPreferences } =
    useContext(AppSettingsProviderContext);
  const { forceRail } = useContext(LayoutProviderContext);

  // A narrow window always wins over the stored preference.
  const isCollapsed = props.isCollapsed || forceRail;

  // Save the sidebar state to cache
  useEffect(() => {
    EnjoyApp.cacheObjects.set("sidebarOpen", props.isCollapsed);
  }, [props.isCollapsed]);

  // Restore the sidebar state from cache
  useEffect(() => {
    EnjoyApp.cacheObjects.get("sidebarOpen").then((value) => {
      if (value !== undefined) {
        setIsCollapsed(!!value);
      }
    });
  }, []);

  useEffect(() => {
    if (displayPreferences) {
      EnjoyApp.view.hide();
    } else {
      EnjoyApp.view.show();
    }
  }, [displayPreferences]);

  const width = isCollapsed
    ? "w-[--sidebar-collapsed-width]"
    : "w-[--sidebar-expanded-width]";

  return (
    <div
      className={cn(
        "h-content shrink-0 relative draggable-region",
        "transition-[width] duration-[220ms] ease-out",
        width
      )}
      data-testid="sidebar"
    >
      <div
        className={cn(
          "fixed top-titlebar bottom-0 left-0 bg-ej-side border-r border-ej-line",
          "flex flex-col transition-[width] duration-[220ms] ease-out",
          width
        )}
      >
        <SidebarHeader isCollapsed={isCollapsed} />

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3">
          {navGroups().map((group, index) => (
            <div key={group.label ?? `group-${index}`} className="mb-1.5">
              {group.label && !isCollapsed && (
                <div className="ej-label px-2.5 pt-3 pb-1.5">{group.label}</div>
              )}
              {group.label && isCollapsed && (
                <div className="mx-2 my-2 h-px bg-ej-line" />
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    {...item}
                    isCollapsed={isCollapsed}
                    active={
                      item.exact
                        ? activeTab === item.href
                        : activeTab.startsWith(item.href)
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-2.5 py-2.5 border-t border-ej-line flex flex-col gap-0.5">
          <SidebarAction
            label={t("sidebar.preferences")}
            Icon={SettingsIcon}
            isCollapsed={isCollapsed}
            active={displayPreferences}
            testid="preferences-button"
            onClick={() => setDisplayPreferences(true)}
          />
          {!forceRail && (
            <SidebarAction
              label={isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              Icon={isCollapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon}
              isCollapsed={isCollapsed}
              onClick={() => setIsCollapsed(!props.isCollapsed)}
            />
          )}
        </div>

        <Dialog open={displayPreferences} onOpenChange={setDisplayPreferences}>
          <DialogContent
            aria-describedby={undefined}
            container={document.body}
            hideClose
            overlayClassName="bg-[rgba(20,22,25,0.4)] backdrop-blur-[2px]"
            className="max-w-[1000px] w-[calc(100vw-80px)] h-[720px] max-h-[calc(100vh-80px)] p-0 gap-0 overflow-hidden rounded-ej-lg border-ej-line bg-ej-surface shadow-ej animate-rise"
          >
            <DialogTitle className="hidden">
              {t("sidebar.preferences")}
            </DialogTitle>
            <Preferences />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

const itemClass = (active: boolean, isCollapsed: boolean) =>
  cn(
    "h-[34px] rounded-[9px] flex items-center shrink-0",
    "text-[13px] transition-colors duration-ej non-draggable-region",
    isCollapsed ? "justify-center px-0" : "px-2.5 gap-2.5",
    active
      ? "bg-ej-surface text-ej-ink font-semibold shadow-ej"
      : "text-ej-ink2 hover:bg-ej-surface2 hover:text-ej-ink"
  );

const SidebarItem = (
  props: NavEntry & { active: boolean; isCollapsed: boolean }
) => {
  const { href, label, active, Icon, testid, isCollapsed } = props;

  return (
    <Link
      to={href}
      data-tooltip-id={isCollapsed ? "global-tooltip" : undefined}
      data-tooltip-content={isCollapsed ? label : undefined}
      data-tooltip-place="right"
      data-testid={testid}
      className={itemClass(active, isCollapsed)}
    >
      <Icon
        className={cn("size-4 shrink-0", active && "text-ej-accent")}
        strokeWidth={active ? 2.2 : 1.8}
      />
      {!isCollapsed && <span className="truncate">{label}</span>}
    </Link>
  );
};

const SidebarAction = (props: {
  label: string;
  Icon: LucideIcon;
  isCollapsed: boolean;
  active?: boolean;
  testid?: string;
  onClick: () => void;
}) => {
  const { label, Icon, isCollapsed, active, testid, onClick } = props;

  return (
    <button
      type="button"
      id={testid}
      data-tooltip-id={isCollapsed ? "global-tooltip" : undefined}
      data-tooltip-content={isCollapsed ? label : undefined}
      data-tooltip-place="right"
      onClick={onClick}
      className={cn(itemClass(!!active, isCollapsed), "w-full")}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      {!isCollapsed && <span className="truncate">{label}</span>}
    </button>
  );
};

const SidebarHeader = (props: { isCollapsed: boolean }) => {
  const { isCollapsed } = props;
  const { user, setDisplayPreferences } = useContext(
    AppSettingsProviderContext
  );
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const name = user.name || "Local";

  return (
    <div className="p-2.5 non-draggable-region">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="open-local-profile-settings"
            className={cn(
              "w-full h-[46px] rounded-[11px] flex items-center transition-colors duration-ej",
              "hover:bg-ej-surface2",
              isCollapsed ? "justify-center px-0" : "px-2 gap-2.5"
            )}
          >
            <GradientAvatar name={name} id={user.id} size={30} square />
            {!isCollapsed && (
              <>
                <div className="min-w-0 flex-1 text-left leading-tight">
                  <div className="text-[13px] font-semibold text-ej-ink truncate">
                    {name}
                  </div>
                  <div className="text-[11px] text-ej-muted truncate">
                    {t("sidebar.localData")}
                  </div>
                </div>
                <ChevronsUpDownIcon className="size-3.5 text-ej-muted shrink-0" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="bottom" className="w-56">
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => navigate("/profile")}
          >
            <UserIcon className="size-4" />
            {t("sidebar.profileStats")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => setDisplayPreferences?.(true)}
          >
            <LibraryBigIcon className="size-4" />
            {t("sidebar.dataLibrary")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => navigate("/landing")}
          >
            <RepeatIcon className="size-4" />
            {t("sidebar.switchProfile")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
