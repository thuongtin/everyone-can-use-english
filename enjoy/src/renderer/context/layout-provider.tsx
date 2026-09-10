import { createContext, useContext, useEffect, useState } from "react";

export type LayoutPref = "auto" | "fixed" | "fluid";

/** Window width at which the "auto" preference switches to the fluid layout. */
export const FLUID_AUTO_WIDTH = 1440;
/** Below this width the fluid layout has no room, even when pinned. */
export const FLUID_MIN_WIDTH = 1100;
/** Below this width the sidebar is forced into its 60px rail. */
export const SIDEBAR_RAIL_WIDTH = 980;

type LayoutProviderState = {
  /** The user's declared preference. */
  layoutPref: LayoutPref;
  setLayoutPref: (pref: LayoutPref) => void;
  /** Whether the fluid layout is currently in effect. */
  fluid: boolean;
  /** True when "fluid" is pinned but the window is too narrow to honour it. */
  fluidPending: boolean;
  /** True when the window is too narrow for an expanded sidebar. */
  forceRail: boolean;
  /** Current window width, kept in sync with resize. */
  windowWidth: number;
  /** Flip between fixed and fluid, pinning the result (never leaves it on auto). */
  toggleFluid: () => void;
};

const STORAGE_KEY = "enjoy-layout-pref";

const initialState: LayoutProviderState = {
  layoutPref: "auto",
  setLayoutPref: () => null,
  fluid: false,
  fluidPending: false,
  forceRail: false,
  windowWidth: 0,
  toggleFluid: () => null,
};

export const LayoutProviderContext =
  createContext<LayoutProviderState>(initialState);

const readStoredPref = (): LayoutPref => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "fixed" || stored === "fluid" || stored === "auto"
    ? stored
    : "auto";
};

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [layoutPref, setLayoutPrefState] = useState<LayoutPref>(readStoredPref);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fluid =
    (layoutPref === "fluid" && windowWidth >= FLUID_MIN_WIDTH) ||
    (layoutPref === "auto" && windowWidth >= FLUID_AUTO_WIDTH);

  useEffect(() => {
    document.documentElement.dataset.fluid = fluid ? "true" : "false";
  }, [fluid]);

  const setLayoutPref = (pref: LayoutPref) => {
    localStorage.setItem(STORAGE_KEY, pref);
    setLayoutPrefState(pref);
  };

  const value: LayoutProviderState = {
    layoutPref,
    setLayoutPref,
    fluid,
    fluidPending: layoutPref === "fluid" && !fluid,
    forceRail: windowWidth < SIDEBAR_RAIL_WIDTH,
    windowWidth,
    toggleFluid: () => setLayoutPref(fluid ? "fixed" : "fluid"),
  };

  return (
    <LayoutProviderContext.Provider value={value}>
      {children}
    </LayoutProviderContext.Provider>
  );
}

export const useLayout = () => useContext(LayoutProviderContext);
