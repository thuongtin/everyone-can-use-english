import { resolveUiLanguage } from "@/constants/ui-language";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/vi";
import "dayjs/locale/es";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import localeData from "dayjs/plugin/localeData";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import duration from "dayjs/plugin/duration";
import i18next from "i18next";

dayjs.extend(localizedFormat);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(localeData);
dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.locale(resolveUiLanguage(i18next.resolvedLanguage));
i18next.on("languageChanged", (language) => {
  dayjs.locale(resolveUiLanguage(language));
});
try {
  dayjs.tz.setDefault(Intl.DateTimeFormat().resolvedOptions().timeZone);
} catch (e) {
  dayjs.tz.guess();
}

export default dayjs;
