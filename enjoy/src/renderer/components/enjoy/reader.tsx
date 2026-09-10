import { createContext, useContext, useState } from "react";
import { EjIconButton } from "./icon-button";
import { cn } from "@renderer/lib/utils";
import { t } from "i18next";

export const EJ_READER_MIN_SIZE = 14;
export const EJ_READER_MAX_SIZE = 22;
export const EJ_READER_DEFAULT_SIZE = 17;

type EjReaderContextType = {
  fontSize: number;
  setFontSize: (size: number) => void;
};

export const EjReaderContext = createContext<EjReaderContextType>({
  fontSize: EJ_READER_DEFAULT_SIZE,
  setFontSize: () => {},
});

/**
 * Reading column scope: owns the A- / A+ font size and exposes it to the
 * Literata typography rules (.ej-reader / .ej-prose) as --ej-reader-size.
 */
export const EjReader = (props: {
  className?: string;
  children: React.ReactNode;
}) => {
  const { className, children } = props;
  const [fontSize, setFontSize] = useState(EJ_READER_DEFAULT_SIZE);

  return (
    <EjReaderContext.Provider value={{ fontSize, setFontSize }}>
      <div
        className={cn("ej-reader", className)}
        style={{ ["--ej-reader-size" as any]: `${fontSize}px` }}
      >
        {children}
      </div>
    </EjReaderContext.Provider>
  );
};

/** The A- / A+ pair, usable in any toolbar rendered inside an EjReader. */
export const EjReaderFontSize = () => {
  const { fontSize, setFontSize } = useContext(EjReaderContext);

  return (
    <>
      <EjIconButton
        title={t("decreaseFontSize")}
        disabled={fontSize <= EJ_READER_MIN_SIZE}
        onClick={() => setFontSize(Math.max(EJ_READER_MIN_SIZE, fontSize - 1))}
      >
        <span className="text-[11px] font-bold">A-</span>
      </EjIconButton>
      <EjIconButton
        title={t("increaseFontSize")}
        disabled={fontSize >= EJ_READER_MAX_SIZE}
        onClick={() => setFontSize(Math.min(EJ_READER_MAX_SIZE, fontSize + 1))}
      >
        <span className="text-[14px] font-bold">A+</span>
      </EjIconButton>
    </>
  );
};
